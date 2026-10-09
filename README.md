# 🛡️ Tamper-Proof SIEM dApp

Sistem alarm anti-hapus log berbasis blockchain. Log server ditandai dengan
**hash SHA-256**, lalu hash itu "dikunci" di smart contract Ethereum. Kalau
penyerang masuk ke server dan mengubah/menghapus log untuk menghilangkan jejak,
hash server tidak akan cocok lagi dengan hash on-chain → event
`TamperingDetected` dipancarkan → frontend menaikkan **alarm real-time**.

---

## 👥 Pembagian Peran

| Peran | Nama | Tanggung jawab |
|---|---|---|
| Smart Contract / Web3 Lead | **Vincent** | `contracts/SIEMLogger.sol`, ABI, deploy testnet |
| Backend Log Collector | **Yasin** | baca file `.log`, hitung SHA-256, kirim/baca ke kontrak |
| Frontend dApp | **Joseph** | UI status log + alarm real-time |

---

## ✅ Status Deliverable

| # | Deliverable | Status | Lokasi |
|---|---|---|---|
| 1 | Kode kontrak `SIEMLogger.sol` (v2.0) | ✅ selesai & lulus 11 test | [`contracts/SIEMLogger.sol`](contracts/SIEMLogger.sol) |
| 2 | File ABI (JSON) | ✅ selesai (hasil compile terverifikasi) | [`contracts/SIEMLogger.json`](contracts/SIEMLogger.json) |
| 3 | Bytecode (bonus, untuk deploy tanpa Remix) | ✅ selesai | [`contracts/SIEMLogger.bytecode.txt`](contracts/SIEMLogger.bytecode.txt) |
| 4 | Deploy testnet + Contract Address | ⏳ **menunggu Vincent** — ikuti [`DEPLOY.md`](DEPLOY.md) | [`deployments.json`](deployments.json) |
| 5 | Multi-admin + optimasi gas (v2.0) | ✅ selesai | lihat [`CHANGELOG.md`](CHANGELOG.md) |

---

## 🛠️ Tech Stack

- **Solidity** `0.8.26` (optimizer runs 200, EVM `paris`)
- **Remix IDE** — tempat kerja utama Vincent: https://remix.ethereum.org
- **Hardhat + ethers v6 + chai** — hanya untuk `npm test` (opsional, lihat bawah)
- **Testnet** — Ethereum Sepolia (chainId `11155111`) atau Polygon Amoy (`80002`)

---

## 📌 Fitur

- **Log Integrity Check** — hash SHA-256 batch log disimpan on-chain.
- **Tamper Detection** — event `TamperingDetected` dipancarkan saat hash server
  ≠ hash on-chain; frontend mendengarkannya untuk alarm real-time.
- **Multi-admin (RBAC)** — owner dapat menambah/mencabut akun admin, mis. akun
  khusus untuk server backend.
- **Verifikasi gratis** — `verifyLogIntegrityView` bisa dipanggil berkali-kali
  tanpa gas untuk menampilkan status di UI.

---

## 📂 Struktur Repo

```
tamper-proof-siem-dapp/
├── contracts/
│   ├── SIEMLogger.sol            ← kode smart contract (v2.0)
│   ├── SIEMLogger.json           ← ABI untuk Yasin & Joseph
│   └── SIEMLogger.bytecode.txt   ← bytecode hasil compile
├── test/
│   └── SIEMLogger.test.js        ← 11 test otomatis
├── deployments.json              ← alamat kontrak per network (diisi saat deploy)
├── DEPLOY.md                     ← panduan deploy testnet + serah terima ke tim
├── CHANGELOG.md                  ← apa yang berubah dari v1.0 ke v2.0
├── hardhat.config.js             ← setting compile (samakan dengan Remix)
└── package.json
```

---

## 📖 API Smart Contract

### Fungsi inti (sama seperti v1.0 — aman untuk Yasin & Joseph)

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `recordLogHash(string logId, string logHash)` | admin | ~208k | Kunci hash log ke blockchain (sekali saja per `logId`) |
| `verifyLogIntegrity(string logId, string currentHash) returns (bool)` | admin | ~45k | Bandingkan; kalau beda → set `isTampered` + emit `TamperingDetected` |
| `getLogStatus(string logId) returns (string, uint256, bool)` | siapa saja | 0 | Ambil `(hash asli, waktu daftar, isTampered)` |

### Tambahan v2.0

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `verifyLogIntegrityView(logId, currentHash) returns (bool)` | siapa saja | **0** | Cek integritas tanpa gas — pakai ini untuk polling/UI |
| `recordLogHashBatch(string[] ids, string[] hashes)` | admin | ~169k/log | Impor banyak log sekaligus (hemat ±39k gas/log) |
| `getLogEntry(logId)` | siapa saja | 0 | Semua field: hash, timestamp, verifiedAt, isTampered, recordedBy |
| `getLogCount()` / `getLogIds()` / `getLogIdAt(i)` | siapa saja | 0 | Daftar semua log (untuk UI) |
| `addAdmin(address)` / `removeAdmin(address)` | **owner** | — | Kelola akun admin |
| `getAdmins() returns (address[])` / `adminCount()` | siapa saja | — | Lihat daftar admin |

### Event

| Event | Kapan muncul | Dipakai oleh |
|---|---|---|
| `LogRecorded(logId, logHash, timestamp)` | saat hash dikunci | Yasin (konfirmasi) |
| `LogVerified(logId, currentHash, isMatch, timestamp)` | tiap verifikasi | Joseph (log aktivitas) |
| **`TamperingDetected(logId, expectedHash, actualHash)`** | **hash server ≠ on-chain** | **Joseph → 🔴 ALARM** |
| `AdminAdded` / `AdminRemoved` | saat admin diubah | audit |

### Error (custom error, bukan string)

`NotOwner`, `NotAdmin`, `InvalidAddress`, `AlreadyAdmin(account)`,
`CannotRemoveOwner`, `LogAlreadyExists(logId)`, `LogNotFound(logId)`,
`EmptyHash`, `LengthMismatch`.

---

## 🧪 Menjalankan Test (opsional)

Kalau mau membuktikan kontraknya benar-benar jalan tanpa buka Remix:

```bash
npm install
npm test
```

Hasil yang diharapkan (sudah dijalankan, 11 test lolos):

```
SIEMLogger v2.0
  ✔ 1. deploy: owner jadi admin pertama, VERSION benar
  ✔ 2. recordLogHash menyimpan hash + getLogStatus mengembalikannya
  ✔ 3. logId tidak bisa didaftarkan dua kali
  ✔ 4. hanya admin yang boleh menulis log
        gas verifyLogIntegrity (cocok) = 45161
  ✔ 5. verifyLogIntegrity: hash cocok -> true, TIDAK ada alarm
  ✔ 6. verifyLogIntegrity: HASH DIUBAH -> false + event TamperingDetected
  ✔ 7. verifyLogIntegrityView: gratis, hasil sama, tidak mengubah state
  ✔ 8. logId yang belum terdaftar -> LogNotFound
  ✔ 9. multi-admin: addAdmin / removeAdmin / proteksi owner
  ✔ 10. recordLogHashBatch: impor banyak log, hemat gas
        1 log  (single tx) = 208134 gas
        5 log  (1 batch tx) = 843023 gas
  ✔ 11. gas: bandingkan single vs batch (biaya dasar per transaksi)

  11 passing
```

---

## 🚀 Cara Deploy ke Testnet

Ikuti langkah lengkap di **[`DEPLOY.md`](DEPLOY.md)**. Ringkasnya:

1. Tambah network Sepolia/Amoy ke MetaMask.
2. Ambil token gratis dari faucet.
3. Buka `SIEMLogger.sol` di Remix → compile `0.8.26` + optimizer 200.
4. Environment → **Injected Provider - MetaMask** → **Deploy**.
5. Catat **Contract Address** → isi `deployments.json` → bagikan ke Yasin & Joseph.

---

## 🗺️ Roadmap

- [x] **v1.0** — `recordLogHash`, `verifyLogIntegrity`, `getLogStatus`.
- [x] **v2.0** — multi-admin, verifikasi gratis (`view`), batch record,
      custom error, optimasi gas & packing struct.
- [ ] **v2.1** — deploy ke Sepolia + Amoy, verifikasi kontrak di explorer.
- [ ] **v3.0** (kalau waktu cukup) — simpan hash sebagai `bytes32` (hemat gas
      signifikan dari penyimpanan string), + Merkle root per batch log.

---

## ❓ FAQ

**Kenapa `verifyLogIntegrity` perlu gas, padahal cuma "membandingkan"?**
Karena versi itu **menulis** hasilnya ke blockchain (`isTampered = true`) dan
memancarkan event. Kalau cuma mau *melihat* hasilnya, pakai
`verifyLogIntegrityView` — gratis.

**Kenapa log-nya tidak bisa di-update?**
Memang sengaja. Kalau hash bisa ditimpa, penyerang yang berhasil masuk ke akun
admin juga bisa menimpa hash asli dan alarmnya hilang. Prinsipnya: hash asli
harus *immutable*. Kalau file log memang di-*rotate*, pakai `logId` baru
(mis. `auth.log#2026-10-09`).

**Siapa yang memicu alarm?**
Backend (Yasin). Alur: baca file log → hitung SHA-256 → panggil
`verifyLogIntegrity`. Kalau hasilnya `false`, kontrak otomatis memancarkan
`TamperingDetected`, dan frontend (Joseph) yang sedang mendengarkan event itu
langsung menampilkan alarm.
