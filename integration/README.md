# 🔌 Integration Kit

Titik sambung antara smart contract (Vincent) dengan backend (Yasin) dan
frontend (Joseph). Dua-duanya memakai ABI yang sama:
[`contracts/SIEMLogger.json`](../contracts/SIEMLogger.json).

```
integration/
├── backend/
│   ├── logCollector.js      ← SKRIP 1: SHA-256 file utuh (tanpa DB)
│   ├── merkleCollector.js   ← SKRIP 2: Merkle Tree + bukti per baris (README_MERKLE.md)
│   ├── collectorService.js  ← DAEMON: batch baru -> record + verify otomatis
│   ├── lib/collector-core.js← kode bersama semua skrip (hash, proof, manifest, batch)
│   ├── lib/batch-queue.js   ← logika antrean collectorService (murni, ada unit test)
│   ├── README_MERKLE.md     ← penjelasan jalur Merkle + Merkle proof per baris
│   ├── test/core.test.js    ← 28 unit test tanpa jaringan (npm run test:backend)
│   ├── test/batch-queue.test.js ← 12 unit test antrean (npm run test:backend)
│   ├── .env.example         ← template konfigurasi (salin jadi .env)
│   └── sample/auth.log      ← contoh file log untuk uji coba
└── frontend/                ← SOC Dashboard (React + Vite) — jobdesk #5
    ├── src/                 ← App.jsx, lib/, components/
    ├── public/config.json   ← default untuk dev
    ├── Dockerfile + nginx.conf ← serve SPA + /data (batch & artefak bukti)
    └── legacy-dashboard.html ← dashboard versi satu-file (referensi)
```

---

## 🐳 Cara tercepat: satu perintah (stack gabungan)

Kalau tidak mau menyalakan tiap bagian manual, dari **root repo**:

```bash
cp .env.example .env          # tidak perlu diisi untuk profil lokal
docker compose --profile local up -d --build
```

Yang naik sekaligus: `chain` (Hardhat) → `deploy` (deploy kontrak, alamat
ditulis ke volume `/state`) → `victim-server` (#3 Rafif, sshd + batcher log) →
`collector` (#2 Yasin, daemon) → `dashboard` (#5 Joseph).

| Layanan | Alamat di host |
|---|---|
| Dashboard SOC | http://127.0.0.1:8088 |
| Chain RPC | http://127.0.0.1:8545 |
| SSH server korban (uji serangan) | `ssh -p 2222 victim@127.0.0.1` (password `password123`, akun sengaja lemah) |

Uji alarm lengkapnya:

```bash
# penyerang menghapus satu baris log di server korban
docker exec siem-victim sh -c 'f=$(ls /siem-batches/auth-*.log); sed -i "1d" "$f"'
sleep 40                      # tunggu putaran verifikasi collector
docker logs siem-collector | tail -5
```

Keluaran yang diharapkan: `🔴 TAMPERED …`, `alarm tercatat on-chain`, dan
dashboard (http://127.0.0.1:8088) memunculkan banner merah + badge 🔴 TAMPERED.
Reset bersih: `docker compose --profile local down -v` lalu hapus isi
`infra/siem-batches/` (kecuali `.gitkeep`).

> Profil Sepolia (pakai kontrak yang sudah live, tanpa chain lokal): isi
> `RPC_URL`, `BROWSER_RPC_URL`, `CONTRACT_ADDRESS`, `PRIVATE_KEY` di `.env`
> lalu `docker compose up -d --build` (service `chain` & `deploy` dilewati).

---

## 🧪 Coba manual, satu per satu (tanpa testnet, tanpa MetaMask)

Cara di bawah ini menjelaskan bagian-bagiannya sendiri-sendiri. Butuh 2 terminal.

**Terminal 1 — jalankan blockchain lokal Hardhat:**

```bash
npm install                     # di root repo (sekali saja)
npx hardhat node                # nyala di http://127.0.0.1:8545
```

**Terminal 2 — deploy + uji alur alarm:**

```bash
cd D:/Projects/tamper-proof-siem-dapp

# 1. deploy kontrak ke node lokal
npx hardhat run scripts/deploy.js --network localhost
#    → catat "contract address" yang muncul

# 2. set konfigurasi (private key di bawah ini key dev Hardhat yang publik,
#    aman karena cuma node lokal — JANGAN dipakai di testnet/mainnet)
export RPC_URL=http://127.0.0.1:8545
export CONTRACT_ADDRESS=<alamat hasil deploy>
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 3. daftarkan hash log
node integration/backend/logCollector.js record integration/backend/sample/auth.log "auth.log#2026-10-09"

# 4. cek (harus AMAN)
node integration/backend/logCollector.js watch integration/backend/sample/auth.log "auth.log#2026-10-09" 5 1

# 5. tiru penyerang menghapus jejaknya
grep -v "Failed password" integration/backend/sample/auth.log > t.tmp && mv t.tmp integration/backend/sample/auth.log

# 6. cek lagi -> harus 🔴 TAMPERED + event TamperingDetected
node integration/backend/logCollector.js watch integration/backend/sample/auth.log "auth.log#2026-10-09" 5 1

# 7. tiru penyerang MENGHAPUS file log (skenario paling umum: buang jejak)
rm integration/backend/sample/auth.log
node integration/backend/logCollector.js watch integration/backend/sample/auth.log "auth.log#2026-10-09" 5 1
#    → harus 🔴 FILE LOG HILANG + event TamperingDetected dengan
#      hash SERVER = 0x__LOG_FILE_MISSING__
```

Untuk dashboard-nya (butuh MetaMask):

```bash
python -m http.server 8788      # dari root repo
# buka http://127.0.0.1:8788/integration/frontend/index.html
```

Pastikan MetaMask diarahkan ke network yang sama (`localhost` / chainId 31337)
dan import akun dev Hardhat (private key di atas) supaya saldonya ada.

---

## 👤 Untuk Yasin (Backend Log Collector)

### Setup

```bash
cp integration/backend/.env.example integration/backend/.env
# lalu isi RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY
```

File `integration/backend/.env` dibaca otomatis oleh `logCollector.js` **dan**
`merkleCollector.js` — path-nya relatif ke lokasi skrip, jadi skrip boleh
dijalankan dari root repo (`node integration/backend/logCollector.js …`).
Kalau `export RPC_URL=…` di shell diisi juga, nilai shell yang menang.

Cukup `npm install` sekali di root repo. `ethers` (dipakai saat *runtime* oleh
kedua skrip) ada di `dependencies`, jadi tetap terpasang walau server memakai
`npm ci --omit=dev` / `NODE_ENV=production`.

### Mode

| Mode | Perintah | Kegunaan |
|---|---|---|
| `record` | `node logCollector.js record <fileLog> <logId>` | Mendaftarkan hash log untuk pertama kali (dikunci on-chain, tidak bisa diubah) |
| `watch` | `node logCollector.js watch <fileLog> <logId> [intervalDetik] [maxIterasi]` | Loop: hitung ulang hash, bandingkan, picu alarm kalau beda |
| `batch` | `node logCollector.js batch <manifest.txt>` | Banyak `logId` dalam **satu transaksi** (`recordLogHashBatch`) — hemat ±17% gas per log (diukur di node lokal: 173.122 vs 208.756 gas/log). Manifest = teks, satu entri per baris `<logId> <path file log>`, `#` untuk komentar |

`merkleCollector.js` punya tiga-mode di atas **plus** `prove` (buktikan baris ke-i
masih identik dengan yang direkam, hanya-baca) — lihat
[`backend/README_MERKLE.md`](backend/README_MERKLE.md).

### Collector service — jalankan otomatis (tanpa perintah manual per file)

Kalau log dihasilkan terus-menerus (mis. server korban #3 yang memotong log jadi
batch), jalankan daemon ini sekali dan biarkan dia bekerja:

```bash
# dari root repo; BATCH_DIR = folder batch hasil log-shipper
export RPC_URL=http://127.0.0.1:8545
export CONTRACT_ADDRESS=<alamat kontrak>
export PRIVATE_KEY=<private key akun SOC_ANALYST>
export BATCH_DIR=./infra/siem-batches        # folder yang ditulis log-shipper
npm run collector                            # daemon
node integration/backend/collectorService.js --once   # satu putaran (untuk uji/CI)
```

Yang dikerjakan tiap putaran:

1. Membaca `index.ndjson` (fallback: memindai `*.log` di `BATCH_DIR`).
2. Batch yang **belum** terdaftar -> dihitung Merkle Root + bukti per baris, lalu
   direkam on-chain. Beberapa batch sekaligus dikirim dalam **satu** transaksi
   (`recordLogHashBatch`): terukur 218.226 vs 253.838 gas/batch.
3. Batch yang sudah terdaftar -> dicek ulang lewat `verifyLogIntegrityView`
   (**gratis**). Kalau hash server berbeda atau file hilang, baru dikirim
   transaksi `verifyLogIntegrity` -> event `TamperingDetected` (alarm dashboard).
4. State disimpan di `<BATCH_DIR>/.collector-state.json` (atomik: tulis `.tmp`
   lalu `rename`), jadi restart tidak merekam ulang dan batch yang sudah
   `tampered` tidak dibuang-buang gas untuk dicek lagi.

Env tambahan: `STATE_PATH`, `SCAN_INTERVAL_MS` (default 10000),
`VERIFY_INTERVAL_MS` (default 30000), `VICTIM_HOST` (awalan `logId` untuk file
yang tidak ada di index). Diuji end-to-end: batch dari server korban -> direkam
otomatis -> batch diubah/dihapus -> alarm `TamperingDetected` tercatat on-chain.

Contoh `logId` yang rapi (biar bisa di-*rotate* harian):
`auth.log#2026-10-09`, `syslog#2026-10-09`.

### Alur yang dipakai skrip

```
1. hash = SHA-256(file log)                   ← crypto bawaan Node
   (kalau file-nya sudah HILANG -> hash = "0x__LOG_FILE_MISSING__", bukan crash)
2. verifyLogIntegrityView(logId, hash)        ← VIEW, GRATIS, tidak butuh gas
   ├─ true  → log aman, lanjut tidur
   └─ false → 3
3. verifyLogIntegrity(logId, hash)            ← transaksi berbayar
   → kontrak set isTampered = true
   → memancarkan event TamperingDetected  ← ini yang ditangkap dashboard Joseph
```

**Dua skenario penyerangan sudah diuji dan dua-duanya kena alarm:**

| Skenario | hash yang dikirim | Hasil |
|---|---|---|
| Isi log diubah (mis. baris dihapus) | hash baru yang berbeda | 🔴 TAMPERED |
| File log dihapus total | `0x__LOG_FILE_MISSING__` | 🔴 FILE LOG HILANG |

Kalau file log dihapus, skrip **tidak crash** — penghapusan diperlakukan sebagai
tampering, karena menghapus jejak justru serangan yang paling sering dipakai.

Kenapa dicek dua langkah? Supaya gas tidak terbuang tiap interval. Transaksi
berbayar hanya dikirim saat benar-benar ada tampering.

### Syarat role

Akun yang dipakai di `PRIVATE_KEY` harus punya role **SOC_ANALYST** atau
**ADMIN**, kalau tidak transaksinya akan revert dengan `NotOperator`.
Minta Vincent (owner) memanggil:

```solidity
addAnalyst(0x<alamat akun server Yasin>)
```

### Versi Merkle (`merkleCollector.js`) — sudah ada

Skrip di atas adalah versi dasar: `logHash` = **SHA-256 seluruh file**. Versi
lanjutan dari #2 memecah log **baris per baris**, membangun **Merkle Tree**,
mengunci **Merkle Root** on-chain, dan menyimpan baris mentahnya di
**MongoDB**. Detailnya di
[`backend/README_MERKLE.md`](backend/README_MERKLE.md).

| Skrip | Nilai yang dikirim sebagai `logHash` | MongoDB |
|---|---|---|
| `logCollector.js` | SHA-256 seluruh file | tidak dipakai |
| `merkleCollector.js` | Merkle Root (dari hash tiap baris) | **opsional** (untuk diff per baris) |

> `merkleCollector.js` **selalu** menulis file bukti
> `<fileLog>.<logId>.proofs.json` saat `record`/`batch` — jadi Merkle proof
> tetap bisa dipakai walau MongoDB tidak dipasang. Isi file bukti tidak perlu
> dipercaya: yang jadi patokan verifikasi tetap Merkle Root on-chain.

Keduanya sekarang: CLI sama (`record` / `watch [intervalDetik] [maxIterasi]`),
memakai kode bersama di [`backend/lib/collector-core.js`](backend/lib/collector-core.js),
dan punya unit test tanpa jaringan: `npm run test:backend`.

> ⚠️ **Jangan memakai dua skrip ini untuk `logId` yang sama.** Keduanya
> menghasilkan hash berbeda untuk file yang identik, jadi pengecekan silang
> melaporkan `false` — dan skrip akan mencetak `⚠️ SALAH SKRIP` lalu
> **menahan alarm** supaya `isTampered` tidak tercemar alarm palsu (flag itu
> satu arah). Konvensinya tetap: satu `logId` dikelola satu skrip.

### Sisa pekerjaan di sisi Yasin

- [x] Merkle Tree per baris + Merkle Root sebagai `logHash` (`merkleCollector.js`)
- [x] simpan detail baris log ke database off-chain (MongoDB) — sekarang **opsional**
- [x] kode bersama dipindah ke `lib/collector-core.js` (dulu ~60% duplikat antar skrip)
- [x] unit test backend tanpa jaringan: `npm run test:backend` (28 test)
- [x] **Merkle proof per baris** — `record` menyimpan proof tiap baris
      (`<fileLog>.<logId>.proofs.json`, dan ke MongoDB kalau aktif), lalu
      `prove <fileLog> <logId> [indexBaris]` memverifikasinya terhadap Merkle Root
      **on-chain**. Baris yang cocok terbukti identik; yang diubah terbukti berbeda.
      Tidak butuh MongoDB dan tidak butuh private key (hanya-baca).
- [x] kirim banyak log sekaligus lewat `recordLogHashBatch(ids, hashes)` — mode
      `batch <manifest.txt>` di kedua skrip (hemat ±17% gas per log)
- [x] jalankan sebagai *service*: `collectorService.js` (daemon: rekam batch baru
      + verifikasi berkala, state disimpan di file JSON).
- [x] dibungkus jadi container: service `collector` di `docker-compose.yml`
      (image `docker/app.Dockerfile`, entrypoint `docker/collector-entrypoint.sh`).
      Rangkaian lengkapnya ada di bagian **🐳 Cara tercepat** di atas.

---

## 👤 Untuk Joseph (SOC Dashboard — React)

Versi satu-file (`frontend/legacy-dashboard.html`, butuh MetaMask) sudah digantikan
aplikasi **React + Vite + Tailwind** di [`integration/frontend/`](frontend/).
Detail lengkap ada di [`frontend/README.md`](frontend/README.md).

### Menjalankan

```bash
# cara cepat (bagian dari stack gabungan, dari root repo)
docker compose up -d dashboard        # http://127.0.0.1:8088

# mode pengembangan
cd integration/frontend
NODE_ENV=development npm install
npm run dev                           # http://127.0.0.1:5173
```

Tidak wajib MetaMask: dashboard memakai provider RPC **hanya-baca**, jadi tabel
registry dan alarm tetap jalan tanpa wallet. Tombol *connect wallet* opsional
(hanya untuk badge role).

Konfigurasi dibaca dari `config.json` yang ditulis saat container start
(`RPC_URL`, `CONTRACT_ADDRESS`, `CHAIN_ID`, `NETWORK_NAME`). Kalau alamat kontrak
kosong, dashboard menampilkan input untuk menempel alamat (disimpan di
localStorage) — berguna untuk uji lokal.

### Fitur yang sudah jalan

- **Registry log on-chain** — `getLogCount` + `getLogIdAt` + `getLogEntry`:
  logId, Merkle Root, waktu rekam, verifikasi terakhir, perekam, status.
- **🚨 Alarm real-time** — event `TamperingDetected` → banner merah + judul tab
  berkedip + baris di *Event Stream* (`LogRecorded` / `LogVerified` juga dicatat).
- **Detail per log + panel bukti Merkle per baris (dihitung DI BROWSER)** —
  dashboard mengambil file batch + `…proofs.json`, lalu memverifikasi
  proof-nya dengan WebCrypto terhadap Merkle Root **on-chain**; tersedia juga cek
  ulang gratis lewat `verifyLogIntegrityView`. Jadi klaim integritas tidak
  bergantung pada backend.
- **Filter + export CSV** dari registry, dan auto-refresh tiap `pollSeconds`.

### Yang masih bisa dikembangkan

- [ ] grafik riwayat alarm (harian/mingguan) dan halaman "insiden"
- [ ] autentikasi/role-based UI (sekarang semua data on-chain memang publik)
- [ ] code-splitting: bundle 634 kB (mayoritas `ethers`) masih satu chunk
- [ ] unit test komponen (mis. Vitest + Testing Library)

---

## ⚠️ Catatan penting (jangan sampai salah)

1. **Event `TamperingDetected` tidak muncul sendiri.** Backend-lah yang
   memicunya lewat transaksi `verifyLogIntegrity`. Jadi kalau browser dibuka
   tapi backend tidak jalan, dashboard akan tetap hijau — log-nya memang belum
   dicek ulang.
2. **Dashboard tidak bisa mengecek sendiri "hash server saat ini"**, karena
   hanya server yang punya file log aslinya. Karena itu tabel di dashboard
   menampilkan status `isTampered` *hasil pengecekan terakhir oleh backend*,
   bukan hasil hitung ulang di browser.
3. **Jangan pernah commit file `.env`.** `.gitignore` sudah menutupnya.
4. **Private key di README ini** hanya untuk node lokal Hardhat (key dev yang
   memang publik). Untuk testnet, pakai akun khusus yang saldonya sedikit.
5. `logId` di event sengaja **tidak** di-index supaya isinya bisa dibaca
   langsung dari event. Konsekuensinya: penyaringan per-`logId` dilakukan di
   sisi klien, bukan lewat topic filter. Untuk jumlah log sebesar proyek ini
   tidak masalah.
