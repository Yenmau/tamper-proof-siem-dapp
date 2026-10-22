# 🔌 Integration Kit

Titik sambung antara smart contract (Vincent) dengan backend (Yasin) dan
frontend (Joseph). Dua-duanya memakai ABI yang sama:
[`contracts/SIEMLogger.json`](../contracts/SIEMLogger.json).

```
integration/
├── backend/
│   ├── logCollector.js      ← versi dasar: SHA-256 file utuh (tanpa DB)
│   ├── merkleCollector.js   ← versi lanjutan: Merkle Tree + MongoDB (README_MERKLE.md)
│   ├── README_MERKLE.md     ← penjelasan jalur Merkle + syarat MongoDB
│   ├── .env.example         ← template konfigurasi (salin jadi .env)
│   └── sample/auth.log      ← contoh file log untuk uji coba
└── frontend/
    └── index.html           ← SOC Dashboard (single file, Tailwind + ethers dari CDN)
```

---

## 🧪 Coba dulu secara lokal (tanpa testnet, tanpa MetaMask)

Cara tercepat membuktikan seluruh alur jalan. Butuh 2 terminal.

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

### Dua mode

| Mode | Perintah | Kegunaan |
|---|---|---|
| `record` | `node logCollector.js record <fileLog> <logId>` | Mendaftarkan hash log untuk pertama kali (dikunci on-chain, tidak bisa diubah) |
| `watch` | `node logCollector.js watch <fileLog> <logId> [intervalDetik] [maxIterasi]` | Loop: hitung ulang hash, bandingkan, picu alarm kalau beda |

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
- [x] unit test backend tanpa jaringan: `npm run test:backend`
- [ ] **Merkle proof per baris** — sekarang proof belum dibuat/diverifikasi,
      jadi klaim "baris ke-i tidak berubah" belum terbukti secara kriptografis;
      yang ada baru perbandingan teks dengan salinan MongoDB
- [ ] kirim banyak log sekaligus lewat `recordLogHashBatch(ids, hashes)`
      (hemat ±19% gas per log)
- [ ] jalankan skrip ini sebagai *service* (systemd / Docker) — bagian DevOps #3

---

## 👤 Untuk Joseph (SOC Dashboard)

### Setup

1. Buka [`integration/frontend/index.html`](frontend/index.html).
2. Isi `CONFIG.contractAddress` di bagian atas `<script>` dengan alamat hasil
   deploy. `CONFIG.expectedChainId` disesuaikan:
   `31337` = Hardhat lokal, `11155111` = Sepolia, `80002` = Amoy.
3. Sajikan lewat HTTP (MetaMask tidak jalan di `file://`):
   `python -m http.server 8788` dari root repo.

ABI-nya **ditempel langsung di dalam `index.html`** (7 entri yang dipakai
dashboard), jadi tidak ada lagi `fetch` ke `contracts/SIEMLogger.json`.
Nilai default `CONFIG` sudah menunjuk ke kontrak **Sepolia yang live**
(`0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd`, chainId `11155111`); ganti ke
`0x5FbDB2315678afecb367f032d93F642f64180aa3` + chainId `31337` kalau mau
menguji di node Hardhat lokal.

### Fitur yang sudah jalan

- **Login via Wallet** — tombol *Connect Wallet* → `eth_requestAccounts`.
- **Badge role** — menampilkan role akun yang connect (`ADMIN` / `SOC_ANALYST` / `AUDITOR`).
- **Tabel registry log** — dari `getLogCount()` + `getLogIdAt(i)` + `getLogEntry(logId)`.
- **Badge status** 🟢 AMAN / 🔴 TAMPERED — dari field `isTampered`.
- **🚨 Alarm real-time** — mendengarkan event `TamperingDetected`, memunculkan
  banner merah + judul tab berkedip + masuk ke *Event Stream*.

### Potongan kode inti (yang paling penting)

```javascript
const provider = new ethers.BrowserProvider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = await provider.getSigner();
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// ⚠️ INI yang bikin alarmnya real-time
contract.on("TamperingDetected", (logId, expectedHash, actualHash) => {
  tampilkanAlarm(logId, expectedHash, actualHash);
});
```

### Yang masih perlu Joseph kembangkan

- [ ] ganti Tailwind CDN → Tailwind CLI/build (biar bisa dikustom)
- [ ] pindahkan ke React kalau dosen mensyaratkan (struktur komponennya sudah
      jelas dari `index.html`: Header, StatCard, LogTable, AlarmBanner, EventStream)
- [ ] halaman detail per log (riwayat `LogVerified`, waktu verifikasi terakhir)
- [ ] grafik/riwayat alarm, filter, dan export laporan

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
