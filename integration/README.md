# 🔌 Integration Kit

Titik sambung antara smart contract (Vincent) dengan backend (Yasin) dan
frontend (Joseph). Dua-duanya memakai ABI yang sama:
[`contracts/SIEMLogger.json`](../contracts/SIEMLogger.json).

```
integration/
├── backend/
│   ├── logCollector.js      ← skrip Node.js: baca log, SHA-256, kirim/baca ke kontrak
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
cd integration/backend
cp .env.example .env      # lalu isi RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY
```

`ethers` sudah ada di `node_modules` root repo, jadi cukup `npm install` sekali
di root.

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
2. verifyLogIntegrityView(logId, hash)        ← VIEW, GRATIS, tidak butuh gas
   ├─ true  → log aman, lanjut tidur
   └─ false → 3
3. verifyLogIntegrity(logId, hash)            ← transaksi berbayar
   → kontrak set isTampered = true
   → memancarkan event TamperingDetected  ← ini yang ditangkap dashboard Joseph
```

Kenapa dicek dua langkah? Supaya gas tidak terbuang tiap interval. Transaksi
berbayar hanya dikirim saat benar-benar ada tampering.

### Syarat role

Akun yang dipakai di `PRIVATE_KEY` harus punya role **SOC_ANALYST** atau
**ADMIN**, kalau tidak transaksinya akan revert dengan `NotOperator`.
Minta Vincent (owner) memanggil:

```solidity
addAnalyst(0x<alamat akun server Yasin>)
```

### Langkah lanjutan (untuk Yasin kerjakan)

Skrip ini sengaja dibuat sederhana dan **memakai hash file utuh**. Sesuai
pembagian tugas, berikutnya di sisi Yasin:

- [ ] pecah log per baris/batch lalu bangun **Merkle Tree**, simpan Merkle root
      sebagai `logHash` (lebih efisien daripada hash seluruh file)
- [ ] kirim banyak log sekaligus lewat `recordLogHashBatch(ids, hashes)`
      (hemat ±19% gas per log)
- [ ] simpan detail baris log + Merkle proof di database off-chain
      (MongoDB/PostgreSQL)
- [ ] jalankan skrip ini sebagai *service* (systemd / Docker) — bagian DevOps

---

## 👤 Untuk Joseph (SOC Dashboard)

### Setup

1. Buka [`integration/frontend/index.html`](frontend/index.html).
2. Isi `CONFIG.contractAddress` di bagian atas `<script>` dengan alamat hasil
   deploy. `CONFIG.expectedChainId` disesuaikan:
   `31337` = Hardhat lokal, `11155111` = Sepolia, `80002` = Amoy.
3. Sajikan lewat HTTP (MetaMask tidak jalan di `file://`):
   `python -m http.server 8788` dari root repo.

ABI di-load otomatis dari `contracts/SIEMLogger.json`, tidak perlu di-copy.

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
