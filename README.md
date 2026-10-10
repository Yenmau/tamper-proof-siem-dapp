# 🛡️ Tamper-Proof SIEM dApp

Sistem alarm anti-hapus log berbasis blockchain. Log server ditandai dengan
**hash SHA-256**, lalu hash itu "dikunci" di smart contract Ethereum. Kalau
penyerang masuk ke server dan mengubah/menghapus log untuk menghilangkan jejak,
hash server tidak akan cocok lagi dengan hash on-chain → event
`TamperingDetected` dipancarkan → frontend menaikkan **alarm real-time**.

**Kontrak live (Sepolia): [`0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd`](https://sepolia.etherscan.io/address/0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd)**
— lihat [`deployments.json`](deployments.json) dan [`HANDOVER.md`](HANDOVER.md).

---

## 👥 Pembagian Peran Tim

| # | Peran | Nama | Tanggung jawab |
|---|---|---|---|
| 1 | **Smart Contract Developer / Web3 Lead** | **Vincent** | `contracts/SIEMLogger.sol`, RBAC 3 role, ABI, deploy testnet |
| 2 | Cryptographic & Backend Engineer | Yasin | skrip pemroses log (SHA-256 / Merkle Tree), koneksi DB off-chain |
| 3 | System & Infrastructure (DevOps) | — | server Linux (VM/Docker), syslog/rsyslog, daemon pengirim log |
| 4 | Red Team & Exploit Specialist | — | skenario serangan (brute force SSH), skrip manipulasi log, PoC |
| 5 | Frontend Engineer (SOC Dashboard) | Joseph | React/HTML+Tailwind, login MetaMask, alarm real-time |
| 6 | Cybersecurity Auditor & QA Lead | — | koordinasi repo, threat modeling, laporan audit (CVSS v4.0) |

> Repo ini fokus ke **pekerjaan #1 (Smart Contract)**. Folder `backend/` dan
> `frontend/` belum ada di sini — dipegang #2 dan #5.

---

## ✅ Status Deliverable

| # | Deliverable | Status | Lokasi |
|---|---|---|---|
| 1 | Kode kontrak `SIEMLogger.sol` | ✅ selesai, lulus 15 test | [`contracts/SIEMLogger.sol`](contracts/SIEMLogger.sol) |
| 2 | Fungsi pencatatan hash | ✅ `recordLogHash` + `recordLogHashBatch` | — |
| 3 | Fungsi verifikasi integritas | ✅ `verifyLogIntegrity` + `verifyLogIntegrityView` | — |
| 4 | Otorisasi 3 role (Admin, SOC Analyst, Auditor) | ✅ selesai (v3.0) | lihat [Matriks RBAC](#-rbac--3-role) |
| 5 | File ABI (JSON) | ✅ 44 entri, hasil compile terverifikasi | [`contracts/SIEMLogger.json`](contracts/SIEMLogger.json) |
| 6 | Bytecode (bonus) | ✅ 8.948 byte | [`contracts/SIEMLogger.bytecode.txt`](contracts/SIEMLogger.bytecode.txt) |
| 7 | Deploy testnet + Contract Address | ✅ **Sepolia** `0x1E6b...0BbBd` | [`deployments.json`](deployments.json) |
| 8 | Kit integrasi (backend + frontend) | ✅ selesai & diuji end-to-end | [`integration/`](integration/) |

---

## 🔐 RBAC — 3 Role

```solidity
enum Role { NONE, AUDITOR, SOC_ANALYST, ADMIN }
```

| Role | Nilai | Tulis log | Verifikasi + alarm | Verifikasi gratis (`View`) | Kelola role |
|---|---|---|---|---|---|
| `ADMIN` | 3 | ✅ | ✅ | ✅ | ✅ |
| `SOC_ANALYST` | 2 | ✅ | ✅ | ✅ | ❌ |
| `AUDITOR` | 1 | ❌ | ❌ | ✅ | ❌ |
| `NONE` (publik) | 0 | ❌ | ❌ | ✅ | ❌ |

**Kenapa `AUDITOR` sengaja read-only?** Prinsip *separation of duties* —
auditor tidak boleh bisa mengubah data yang dia audit; kalau bisa, hasil
auditnya tidak bernilai. Auditor tetap bisa menguji integritas lewat
`verifyLogIntegrityView` (view, gratis, tidak mengubah state).

Akun yang deploy otomatis menjadi `ADMIN` (owner) dan **tidak bisa dicabut**.
Role lain diberikan oleh ADMIN lewat `setRole` / `addAnalyst` / `addAuditor` /
`addAdmin`.

---

## 🛠️ Tech Stack

- **Solidity** `0.8.26` (optimizer runs 200, EVM `paris`)
- **Remix IDE** — tempat kerja utama Vincent: https://remix.ethereum.org
- **Hardhat + ethers v6 + chai** — untuk `npm test` (opsional)
- **Testnet** — Ethereum Sepolia (chainId `11155111`) atau Polygon Amoy (`80002`)

---

## 📌 Fitur

- **Log Integrity Check** — hash SHA-256 batch log disimpan on-chain.
- **Tamper Detection** — event `TamperingDetected` saat hash server ≠ hash
  on-chain; frontend mendengarkannya untuk alarm real-time.
- **RBAC 3 role** — Admin / SOC Analyst / Auditor, dengan auditor read-only.
- **Verifikasi gratis** — `verifyLogIntegrityView` (view, 0 gas).
- **Batch record** — impor banyak log dalam 1 transaksi.

---

## 📂 Struktur Repo

```
tamper-proof-siem-dapp/
├── contracts/
│   ├── SIEMLogger.sol            ← kode smart contract (v3.0)
│   ├── SIEMLogger.json           ← ABI untuk Yasin & Joseph
│   └── SIEMLogger.bytecode.txt   ← bytecode hasil compile
├── integration/                  ← kit sambung ke backend & frontend
│   ├── backend/logCollector.js   ← skrip Node.js (Yasin)
│   ├── backend/.env.example
│   ├── backend/sample/auth.log   ← log contoh buat uji coba
│   └── frontend/index.html       ← SOC Dashboard (Joseph)
├── scripts/
│   └── deploy.js                 ← deploy tanpa Remix (opsional)
├── test/
│   └── SIEMLogger.test.js        ← 15 test otomatis (RBAC + fungsi inti + gas)
├── deployments.json              ← alamat kontrak per network (diisi saat deploy)
├── DEPLOY.md                     ← panduan deploy testnet + set role + serah terima
├── CHANGELOG.md                  ← riwayat perubahan v1.0 → v2.0 → v3.0
├── hardhat.config.js             ← setting compile (samakan dengan Remix)
└── package.json
```

---

## 📖 API Smart Contract

### Fungsi inti (sama seperti v1.0 — aman untuk Yasin & Joseph)

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `recordLogHash(string logId, string logHash)` | ANALYST, ADMIN | ~208k | Kunci hash log ke blockchain (sekali saja per `logId`) |
| `verifyLogIntegrity(string logId, string currentHash) returns (bool)` | ANALYST, ADMIN | ~45k | Bandingkan; kalau beda → set `isTampered` + emit `TamperingDetected` |
| `getLogStatus(string logId) returns (string, uint256, bool)` | siapa saja | 0 | Ambil `(hash asli, waktu daftar, isTampered)` |

### Manajemen role

| Fungsi | Akses |
|---|---|
| `setRole(address, Role)` | ADMIN |
| `addAdmin(address)` / `addAnalyst(address)` / `addAuditor(address)` | ADMIN |
| `removeRole(address)` / `removeAdmin(address)` | ADMIN |
| `roles(address) → uint8`, `getRoleName(address) → string`, `isAdmin(address)`, `isOperator(address)`, `hasRole(address)`, `getAdmins()`, `adminCount()` | siapa saja (view) |

### Tambahan lain

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `verifyLogIntegrityView(logId, currentHash) returns (bool)` | siapa saja | **0** | Cek integritas tanpa gas — pakai ini untuk polling/UI |
| `recordLogHashBatch(string[] ids, string[] hashes)` | ANALYST, ADMIN | ~169k/log | Impor banyak log sekaligus (hemat ±39k gas/log) |
| `getLogEntry(logId)` | siapa saja | 0 | Semua field: hash, timestamp, verifiedAt, isTampered, recordedBy |
| `getLogCount()` / `getLogIds()` / `getLogIdAt(i)` | siapa saja | 0 | Daftar semua log (untuk UI) |

### Event

| Event | Kapan muncul | Dipakai oleh |
|---|---|---|
| `LogRecorded(logId, logHash, timestamp)` | saat hash dikunci | Yasin (konfirmasi) |
| `LogVerified(logId, currentHash, isMatch, timestamp)` | tiap verifikasi | Joseph (log aktivitas) |
| **`TamperingDetected(logId, expectedHash, actualHash)`** | **hash server ≠ on-chain** | **Joseph → 🔴 ALARM** |
| `RoleAssigned(account, role)` / `RoleRevoked(account, previousRole)` | saat role diubah | audit |
| `AdminAdded(account)` / `AdminRemoved(account)` | saat role ADMIN berubah | kompatibilitas v2.0 |

> `logId` pada semua event **tidak di-index** supaya isinya bisa dibaca
> langsung dari payload event. Kalau di-index, yang tersimpan hanya hash-nya
> dan dashboard tidak akan tahu log mana yang bermasalah.

### Error (custom error, bukan string)

`NotOwner`, `NotAdmin`, `NotOperator`, `InvalidAddress`, `InvalidRole`,
`SameRole(account, role)`, `CannotChangeOwner`, `LogAlreadyExists(logId)`,
`LogNotFound(logId)`, `EmptyHash`, `LengthMismatch`.

---

## 🧪 Menjalankan Test (opsional)

```bash
npm install
npm test
```

Hasil yang diharapkan (sudah dijalankan, 15 test lolos):

```
SIEMLogger v3.0
  A. Dasar & RBAC
    ✔ 1. deploy: owner jadi ADMIN pertama, VERSION 3.0.0
    ✔ 2. setRole: ADMIN -> SOC_ANALYST / AUDITOR, nama role benar
    ✔ 3. SOC_ANALYST boleh menulis log, tapi TIDAK boleh kelola role
    ✔ 4. AUDITOR read-only: boleh lihat & verifyLogIntegrityView, TIDAK boleh tulis
    ✔ 5. akun tanpa role (NONE): tidak bisa tulis, tapi tetap bisa baca
    ✔ 6. ADMIN bisa menambah ADMIN lain & mencabutnya
    ✔ 7. proteksi & validasi role
  B. Fungsi inti (kompatibel v1.0)
    ✔ 8. recordLogHash menyimpan hash + getLogStatus mengembalikannya
    ✔ 9. logId tidak bisa didaftarkan dua kali
        gas verifyLogIntegrity (cocok) = 45701
    ✔ 10. verifyLogIntegrity: hash cocok -> true, TIDAK ada alarm
    ✔ 11. verifyLogIntegrity: HASH DIUBAH -> false + event TamperingDetected
    ✔ 12. verifyLogIntegrityView: gratis, hasil sama, tidak mengubah state
    ✔ 13. logId yang belum terdaftar -> LogNotFound
    ✔ 14. recordLogHashBatch: impor banyak log
        1 log  (single tx)  = 208708 gas
        5 log  (1 batch tx) = 845333 gas
        rata-rata batch     = 169066 gas/log
    ✔ 15. gas: batch lebih murah per log daripada single

  15 passing
```

---

## 🚀 Cara Deploy ke Testnet

> ✅ **Sudah dilakukan di Sepolia** — lihat [`deployments.json`](deployments.json).
> Langkah di bawah untuk Amoy atau re-deploy.

Ikuti langkah lengkap di **[`DEPLOY.md`](DEPLOY.md)**. Ringkasnya:

1. Tambah network Sepolia/Amoy ke MetaMask.
2. Ambil token gratis dari faucet.
3. Buka `SIEMLogger.sol` di Remix → compile `0.8.26` + optimizer 200 + EVM paris.
4. Environment → **Injected Provider - MetaMask** → **Deploy**.
5. Set role akun tim (`addAnalyst` untuk Yasin, dst).
6. Catat **Contract Address** → isi `deployments.json` → bagikan ke tim.

---

## 🔌 Integration Kit (sambungan ke tim)

Folder [`integration/`](integration/) berisi titik sambung ke Yasin & Joseph.
Detail lengkap di [`integration/README.md`](integration/README.md).

| Item | Untuk | Isi |
|---|---|---|
| [`integration/backend/logCollector.js`](integration/backend/logCollector.js) | Yasin (#2) | Baca file log → SHA-256 → `recordLogHash` / `verifyLogIntegrity`; mendeteksi tampering dan memicu alarm on-chain |
| [`integration/frontend/index.html`](integration/frontend/index.html) | Joseph (#5) | SOC Dashboard: login MetaMask, tabel status log, banner alarm real-time dari event `TamperingDetected` |
| [`scripts/deploy.js`](scripts/deploy.js) | semua | Deploy tanpa Remix (buat node lokal) |

**Uji seluruh alur secara lokal (2 terminal, tanpa testnet & tanpa MetaMask):**

```bash
# terminal 1
npm install && npx hardhat node

# terminal 2
npx hardhat run scripts/deploy.js --network localhost
export RPC_URL=http://127.0.0.1:8545
export CONTRACT_ADDRESS=<alamat hasil deploy>
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
node integration/backend/logCollector.js record integration/backend/sample/auth.log "auth.log#2026-10-09"
node integration/backend/logCollector.js watch  integration/backend/sample/auth.log "auth.log#2026-10-09" 5 1
```

Alur lengkap yang sudah diuji end-to-end di node lokal: `record` → `watch`
(🟢 AMAN) → isi file log diubah → `watch` (🔴 TAMPERED) → file log dihapus →
`watch` (🔴 FILE LOG HILANG) — keduanya memancarkan event `TamperingDetected`
dengan `logId` yang terbaca, dan `isTampered` menjadi `true` on-chain.

---

## 🗺️ Roadmap

- [x] **v1.0** — `recordLogHash`, `verifyLogIntegrity`, `getLogStatus`.
- [x] **v2.0** — verifikasi gratis (`view`), batch record, custom error,
      optimasi gas & packing struct.
- [x] **v3.0** — RBAC 3 role (Admin / SOC Analyst / Auditor),
      `setRole` / `removeRole` / `addAnalyst` / `addAuditor`,
      event `RoleAssigned` / `RoleRevoked`.
- [x] **v3.1** — deploy ke Sepolia ✅ (`0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd`);
      Amoy + verifikasi explorer menyusul.
- [ ] **v4.0** (kalau waktu cukup) — hash disimpan sebagai `bytes32`
      (hemat gas signifikan dari penyimpanan string) + Merkle root per batch.

---

## ❓ FAQ

**Kenapa `verifyLogIntegrity` perlu gas, padahal cuma "membandingkan"?**
Karena versi itu **menulis** hasilnya ke blockchain (`isTampered = true`) dan
memancarkan event. Kalau cuma mau *melihat* hasilnya, pakai
`verifyLogIntegrityView` — gratis.

**Kenapa auditor tidak boleh ikut menulis?**
Kalau auditor bisa mengubah data yang dia audit, hasil auditnya tidak bisa
dipercaya (bisa jadi dia sendiri yang memalsukan). Jadi auditor sengaja
read-only — ini penerapan *separation of duties*.

**Kenapa log-nya tidak bisa di-update?**
Memang sengaja. Kalau hash bisa ditimpa, penyerang yang berhasil masuk ke akun
admin juga bisa menimpa hash asli dan alarmnya hilang. Prinsipnya: hash asli
harus *immutable*. Kalau file log memang di-*rotate*, pakai `logId` baru
(mis. `auth.log#2026-10-09`).

**Siapa yang memicu alarm?**
Backend (Yasin). Alur: baca file log → hitung SHA-256 → panggil
`verifyLogIntegrity` dari akun ber-role ANALYST/ADMIN. Kalau hasilnya `false`,
kontrak otomatis memancarkan `TamperingDetected`, dan frontend (Joseph) yang
sedang mendengarkan event itu langsung menampilkan alarm.
