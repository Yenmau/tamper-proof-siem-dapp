# 🛡️ Tamper-Proof SIEM dApp

Sistem alarm anti-hapus log berbasis blockchain. Log server ditandai dengan
**hash SHA-256**, lalu hash itu "dikunci" di smart contract Ethereum. Kalau
penyerang masuk ke server dan mengubah/menghapus log untuk menghilangkan jejak,
hash server tidak akan cocok lagi dengan hash on-chain → event
`TamperingDetected` dipancarkan → frontend menaikkan **alarm real-time**.

Sisi "database"-nya memang blockchain: hash log, registry aset, dan role akun
disimpan sebagai state kontrak; data pribadi user (nama/email) disimpan off-chain
di MongoDB karena tidak layak dibayar gas dan tidak perlu publik.

**Kontrak live (Sepolia): [`0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd`](https://sepolia.etherscan.io/address/0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd)**
(versi v3.0; v4.0 menyusul di-deploy ulang) — lihat [`deployments.json`](deployments.json)
dan [`HANDOVER.md`](HANDOVER.md).

📍 **Status terkini, bukti uji, dan sisa pekerjaan: [`STATUS.md`](STATUS.md)**

---

## 📋 Peta Requirement Tugas → Implementasi

Ringkasan untuk penilaian: di mana setiap poin brief dipenuhi.

| # | Requirement brief | Implementasi | Bukti |
|---|---|---|---|
| 1 | On-chain data disimpan di blockchain | kontrak `SIEMLogger` (`contracts/SIEMLogger.sol`) berisi hash log, registry aset, dan role | 22 test Hardhat · live di Sepolia |
| 2 | Tema aplikasi (asset/logging) | **registry log anti-tamper + registry aset** | bagian [Fitur](#-fitur) · `PROGRESS.md` |
| 3 | Authorization ≥3 role | `ADMIN`, `SOC_ANALYST`, `AUDITOR` — ditegakkan on-chain (`onlyAdmin`, `onlyOperator`) | Matriks RBAC · test 1-7 |
| 4 | Authentication login pakai wallet address | halaman **Login** di dashboard: `eth_requestAccounts` lalu role dibaca `getRoleName(address)`; alamat tanpa role ditolak. API off-chain juga memverifikasi tanda tangan `personal_sign` + role on-chain | `integration/frontend/src/components/Login.jsx` · `integration/backend/api/lib/auth.js` · 19 unit test + smoke test |
| 5 | On-chain state management (insert, view, update, delete) | **registry aset** penuh: `createAsset` / `getAsset`+`getAssetIds` / `updateAsset` / `deleteAsset` (create+update oleh ADMIN & SOC_ANALYST, delete oleh ADMIN). Registry log tetap insert+view karena **immutable by design** | test 16-22 · tab *Registry aset* di dashboard |
| 6 | Off-chain state management (insert, view, update, delete) | **data user** di MongoDB lewat REST API Express: `POST`/`GET`/`PUT`/`DELETE /api/users` | `integration/backend/api/` · tab *Data user* · `smoke-test.js` 16/16 lulus |

> Poin 5 sengaja dipisah dua jenis data. Membuka update/delete pada hash log akan
> merusak tujuan proyek (penyerang yang punya akses admin bisa menghapus jejaknya),
> jadi data log tetap sekali-tulis, sedangkan data aset bisa di-CRUD penuh - dan
> setiap penghapusan aset tetap meninggalkan event permanen di blockchain.

---

## 👥 Pembagian Peran Tim

| # | Peran | Nama | Tanggung jawab |
|---|---|---|---|
| 1 | **Smart Contract Developer / Web3 Lead** | **Vincent** | `contracts/SIEMLogger.sol`, RBAC 3 role, ABI, deploy testnet |
| 2 | Cryptographic & Backend Engineer | Yasin | skrip pemroses log (SHA-256 / Merkle Tree), koneksi DB off-chain |
| 3 | System & Infrastructure (DevOps) | Rafif | server Linux (VM/Docker), syslog/rsyslog, daemon pengirim log |
| 4 | Red Team & Exploit Specialist | Michael | skenario serangan (brute force SSH), skrip manipulasi log, PoC |
| 5 | Frontend Engineer (SOC Dashboard) | Joseph | React/HTML+Tailwind, login MetaMask, alarm real-time |
| 6 | Cybersecurity Auditor & QA Lead | Nat | koordinasi repo, threat modeling, laporan audit (CVSS v4.0) |

> Titik sambung ke tim ada di [`integration/`](integration/) — `backend/`
> (kode #2 Yasin) dan `frontend/` (SOC Dashboard #5 Joseph). Folder
> `backend/` dan `frontend/` di root repo tidak dipakai.

---

## ✅ Status Deliverable

| # | Deliverable | Status | Lokasi |
|---|---|---|---|
| 1 | Kode kontrak `SIEMLogger.sol` | ✅ selesai, lulus **22 test** | [`contracts/SIEMLogger.sol`](contracts/SIEMLogger.sol) |
| 2 | Fungsi pencatatan hash | ✅ `recordLogHash` + `recordLogHashBatch` | — |
| 3 | Fungsi verifikasi integritas | ✅ `verifyLogIntegrity` + `verifyLogIntegrityView` | — |
| 4 | Otorisasi 3 role (Admin, SOC Analyst, Auditor) | ✅ selesai (v3.0), dipakai juga oleh registry aset (v4.0) | lihat [Matriks RBAC](#-rbac--3-role) |
| 5 | File ABI (JSON) | ✅ 60 entri, dibuat otomatis (`npm run export-abi`) & dicek CI | [`contracts/SIEMLogger.json`](contracts/SIEMLogger.json) |
| 6 | Bytecode (bonus) | ✅ 8.948 byte | [`contracts/SIEMLogger.bytecode.txt`](contracts/SIEMLogger.bytecode.txt) |
| 7 | Deploy testnet + Contract Address | ✅ **Sepolia** `0x1E6b...0BbBd` | [`deployments.json`](deployments.json) |
| 8 | Kit integrasi (backend + frontend) | ✅ selesai & diuji end-to-end | [`integration/`](integration/) |
| 9 | **Authentication login pakai wallet address** | ✅ halaman login + role dibaca dari kontrak | [`Login.jsx`](integration/frontend/src/components/Login.jsx) |
| 10 | **Registry aset on-chain (CRUD penuh)** | ✅ `createAsset` / `updateAsset` / `deleteAsset` (v4.0) | `contracts/SIEMLogger.sol` · test 16-22 |
| 11 | **Off-chain CRUD data user (Express + MongoDB)** | ✅ REST API + tanda tangan wallet | [`integration/backend/api/`](integration/backend/api/README.md) |

---

## 🔐 RBAC — 3 Role

```solidity
enum Role { NONE, AUDITOR, SOC_ANALYST, ADMIN }
```

| Role | Nilai | Tulis log | Verifikasi + alarm | Verifikasi gratis (`View`) | Aset: create/update | Aset: delete | Kelola role |
|---|---|---|---|---|---|---|---|
| `ADMIN` | 3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `SOC_ANALYST` | 2 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `AUDITOR` | 1 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `NONE` (publik) | 0 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

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
- **Node.js 20+** — skrip backend di `integration/backend/`
- **Express** — API off-chain (data user) di `integration/backend/api/`
- **MongoDB 7** — database off-chain (service `mongo` di `docker compose`)
- **WebCrypto** — verifikasi Merkle proof langsung di browser (dashboard)
- **CI** — GitHub Actions: 22 test kontrak + unit test backend & API + build dashboard +
  validasi stack compose + penjaga encoding/CRLF + cek ABI sinkron dengan kontrak
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
│   ├── SIEMLogger.sol            ← kode smart contract (v4.0)
│   ├── SIEMLogger.json           ← ABI (dibuat otomatis: npm run export-abi)
│   └── SIEMLogger.bytecode.txt   ← bytecode hasil compile
├── infra/                        ← #3: server korban simulasi (Dockerfile + sshd + batcher)
├── docker/                       ← image aplikasi + entrypoint (deploy/collector/api)
│   ├── app.Dockerfile            ← node + dependensi repo (chain/deploy/collector/api)
│   ├── deploy-entrypoint.sh      ← tunggu chain → deploy (idempoten) → tulis alamat ke /state
│   ├── collector-entrypoint.sh   ← siapkan env collector → jalankan daemon
│   └── api-entrypoint.sh         ← siapkan env API off-chain → jalankan server
├── docker-compose.yml            ← stack gabungan (profil `local` & Sepolia)
├── .env.example                  ← template konfigurasi stack gabungan
├── integration/                  ← kit sambung ke backend & frontend
│   ├── backend/logCollector.js   ← #2: SHA-256 file utuh → kontrak
│   ├── backend/merkleCollector.js← #2: Merkle Tree + bukti per baris
│   ├── backend/collectorService.js ← #2: daemon batch → on-chain + verifikasi
│   ├── backend/lib/collector-core.js ← kode bersama semua collector
│   ├── backend/lib/batch-queue.js ← logika antrean service (ada unit test)
│   ├── backend/test/*.test.js    ← 59 unit test backend (tanpa jaringan)
│   ├── backend/api/              ← API OFF-CHAIN (Express + MongoDB): CRUD data user
│   │   ├── server.js             ← endpoint /api/users + /api/health
│   │   ├── lib/auth.js           ← login wallet (tanda tangan) + izin per role
│   │   ├── lib/users.js          ← model & operasi CRUD MongoDB
│   │   ├── smoke-test.js         ← uji end-to-end API (16 pemeriksaan)
│   │   └── README.md             ← cara pakai + skema tanda tangan
│   ├── frontend/                 ← #5: SOC Dashboard React+Vite (src/, Dockerfile, nginx.conf)
│   │   ├── src/components/       ← Login, AssetsPanel, UsersPanel, LogTable, ProofPanel, …
│   │   └── legacy-dashboard.html ← dashboard versi satu-file (referensi)
│   └── README.md                 ← panduan integrasi + uji end-to-end lokal
├── scripts/
│   ├── deploy.js                 ← deploy tanpa Remix (opsional)
│   └── export-abi.js             ← artifact Hardhat → contracts/SIEMLogger.json
├── test/
│   └── SIEMLogger.test.js        ← 22 test otomatis (RBAC + fungsi inti + CRUD aset + gas)
├── .github/workflows/ci.yml      ← CI: test kontrak + unit test backend/API + build + compose
├── deployments.json              ← alamat kontrak per network (diisi saat deploy)
├── DEPLOY.md                     ← panduan deploy testnet + set role + serah terima
├── CHANGELOG.md                  ← riwayat perubahan v1.0 → v4.0
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

### Registry aset — CRUD on-chain (v4.0)

| Fungsi | Akses | Gas (terukur) | Kegunaan |
|---|---|---|---|
| `createAsset(assetId, name, category, location)` | ANALYST, ADMIN | ~233k | **INSERT** aset baru |
| `updateAsset(assetId, name, category, location)` | ANALYST, ADMIN | ~52k | **UPDATE** nama/kategori/lokasi (createdAt & createdBy tidak berubah) |
| `deleteAsset(assetId)` | **ADMIN saja** | ~60k | **DELETE** aset dari state (event penghapusan tetap permanen) |
| `getAsset(assetId)` | siapa saja | 0 | **VIEW** satu aset (name, category, location, createdAt, updatedAt, createdBy, updatedBy) |
| `getAssetCount()` / `getAssetIds()` / `getAssetIdAt(i)` / `assetExists(id)` | siapa saja | 0 | Daftar & cek keberadaan aset untuk UI |
| `canManageAssets(address)` | siapa saja | 0 | Helper UI: boleh menambah/mengubah aset? |
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
| `AssetCreated(assetId, name, category, by, timestamp)` | saat aset dibuat | dashboard (Event Stream) |
| `AssetUpdated(assetId, name, category, by, timestamp)` | saat aset diubah | dashboard |
| **`AssetDeleted(assetId, by, timestamp)`** | **saat aset dihapus** | dashboard — bukti permanen bahwa data pernah ada lalu dihapus |
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
`LogNotFound(logId)`, `EmptyHash`, `LengthMismatch`, `EmptyId`, `EmptyName`,
`AssetAlreadyExists(assetId)`, `AssetNotFound(assetId)`.

---

## 🧪 Menjalankan Test (opsional)

```bash
npm install
npm test            # 22 test kontrak (Hardhat)
npm run test:backend  # 59 unit test backend + API off-chain (tanpa jaringan/DB)
npm run test:api      # 19 di antaranya: autentikasi wallet & izin role
```

Hasil yang diharapkan (sudah dijalankan, 22 test lolos):

```
SIEMLogger v4.0
  A. Dasar & RBAC
    ✔ 1. deploy: owner jadi ADMIN pertama, VERSION 4.0.0
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
  C. Registry aset — CRUD on-chain (v4.0)
    ✔ 16. createAsset: ADMIN & SOC_ANALYST boleh, data tersimpan + event
    ✔ 17. createAsset: RBAC & validasi (outsider/auditor ditolak, id/nama kosong, duplikat)
    ✔ 18. updateAsset: ubah data, updatedBy/updatedAt tercatat, RBAC & validasi
    ✔ 19. deleteAsset: HANYA ADMIN, data benar-benar hilang, daftar tetap konsisten
    ✔ 20. canManageAssets: helper UI sesuai RBAC
        gas createAsset = 233422
        gas updateAsset = 52085
        gas deleteAsset = 59959
    ✔ 21. gas CRUD aset (bahan laporan)
    ✔ 22. log tetap IMMUTABLE walau aset bisa di-CRUD (prinsip keamanan tidak dilanggar)

  22 passing

Uji API off-chain (butuh stack hidup): `node integration/backend/api/smoke-test.js`
  ✔ tanpa login wallet -> 401        ✔ INSERT (ADMIN) -> 201        ✔ UPDATE (SOC_ANALYST) -> 200
  ✔ role NONE -> 403                 ✔ INSERT duplikat -> 409       ✔ UPDATE oleh AUDITOR -> 403
  ✔ DELETE oleh SOC_ANALYST -> 403   ✔ DELETE oleh ADMIN -> 200     ✔ tanda tangan sekali pakai -> 409
  16 lulus, 0 gagal
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

## 🐳 Jalankan Seluruh Stack (satu perintah)

Semua bagian tim sudah disatukan di [`docker-compose.yml`](docker-compose.yml):
chain + deploy kontrak + server korban (#3) + collector (#2) + MongoDB +
API off-chain + dashboard (#5).

```bash
cp .env.example .env                     # profil lokal tidak perlu diisi apa pun
docker compose --profile local up -d --build
```

| Layanan | Isi | Alamat di host |
|---|---|---|
| `chain` | Hardhat node (chainId 31337) | http://127.0.0.1:8545 |
| `deploy` | deploy `SIEMLogger` sekali, alamat ditulis ke volume `/state` | — |
| `victim-server` | server Linux + sshd + batcher log (#3 Rafif) | `ssh -p 2222 victim@127.0.0.1` (password `password123`) |
| `collector` | daemon: batch baru → `recordLogHashBatch`, cek berkala → alarm (#2 Yasin) | — |
| `mongo` | database off-chain (data user) | — |
| `api` | REST API off-chain: CRUD data user (#2 Yasin) | http://127.0.0.1:8089/api/health |
| `dashboard` | SOC Dashboard React (#5 Joseph) + login wallet + tab aset & user | http://127.0.0.1:8088 |

Alamat kontrak **tidak perlu disalin manual**: `deploy` menulisnya ke volume
`/state`, lalu `collector` dan `dashboard` membacanya saat start.

**Simulasi serangan (alur alarm end-to-end, sudah diuji):**

```bash
docker exec siem-victim sh -c 'f=$(ls /siem-batches/auth-*.log); sed -i "1d" "$f"'
sleep 40
docker logs siem-collector | tail -5
#   🔴 TAMPERED victim-server/auth-…
#   alarm tercatat on-chain (gas 52429)
```

Dashboard yang sedang terbuka langsung menampilkan banner **🚨 TAMPERING
DETECTED** + judul tab berkedip, baris log menjadi 🔴 TAMPERED, dan panel
*Bukti Merkle per baris* membuktikan baris mana yang berubah — dihitung ulang di
browser terhadap Merkle Root on-chain, bukan dari backend.

> **Profil Sepolia** (kontrak yang sudah live, tanpa chain lokal): isi `RPC_URL`,
> `BROWSER_RPC_URL` (URL publik yang sama), `CONTRACT_ADDRESS`, dan `PRIVATE_KEY`
> (akun ber-role SOC_ANALYST) di `.env`, lalu `docker compose up -d --build` —
> service `chain` & `deploy` otomatis dilewati.

**Coba login & CRUD lewat dashboard** (buka http://127.0.0.1:8088):

1. Klik **Login dengan Wallet** (MetaMask). Di profil lokal, akun Hardhat #0 sudah
   `ADMIN`; akun #1 `SOC_ANALYST`; akun #2 `AUDITOR`. Akun tanpa role ditolak.
2. Tab **Registry aset (on-chain)** → *Tambah aset* = `createAsset`,
   *ubah* = `updateAsset`, *hapus* (hanya ADMIN) = `deleteAsset`.
   Tombolnya otomatis mati untuk role yang tidak berhak.
3. Tab **Data user (off-chain)** → CRUD data user di MongoDB
   (`POST`/`GET`/`PUT`/`DELETE /api/users`), tiap request ditandatangani wallet.
4. Tidak mau pakai MetaMask? Klik *masuk tanpa wallet (hanya-baca)* — tabel & alarm
   tetap jalan, tombol tulis mati.

Reset bersih: `docker compose --profile local down -v`, lalu kosongkan
`infra/siem-batches/` kecuali `.gitkeep`.

---

## 🔌 Integration Kit (sambungan ke tim)

Folder [`integration/`](integration/) berisi titik sambung ke Yasin & Joseph.
Detail lengkap di [`integration/README.md`](integration/README.md).

| Item | Untuk | Isi |
|---|---|---|
| [`integration/backend/logCollector.js`](integration/backend/logCollector.js) | Yasin (#2) | Baca file log → SHA-256 file utuh → `recordLogHash` / `verifyLogIntegrity`; mendeteksi tampering dan memicu alarm on-chain |
| [`integration/backend/merkleCollector.js`](integration/backend/merkleCollector.js) | Yasin (#2) | Versi Merkle Tree: hash per baris → Merkle Root on-chain, baris mentah di MongoDB. Catatan: [`README_MERKLE.md`](integration/backend/README_MERKLE.md) |
| [`integration/backend/collectorService.js`](integration/backend/collectorService.js) | Yasin (#2) + Rafif (#3) | Daemon: batch baru → `recordLogHashBatch`, cek berkala → alarm. Dipakai oleh stack gabungan `docker compose` |
| [`integration/backend/lib/collector-core.js`](integration/backend/lib/collector-core.js) | Yasin (#2) | Kode bersama semua collector + Merkle proof + manifest batch |
| [`integration/backend/api/`](integration/backend/api/README.md) | Yasin (#2) | API off-chain (Express + MongoDB): CRUD data user, login tanda tangan wallet, izin per role on-chain |
| [`integration/frontend/`](integration/frontend/) | Joseph (#5) | SOC Dashboard **React + Vite**: login wallet, registry log on-chain, alarm real-time, detail per log + verifikasi Merkle proof di browser, registry aset (CRUD), data user (CRUD), export CSV |
| [`scripts/deploy.js`](scripts/deploy.js) | semua | Deploy tanpa Remix (buat node lokal) |

> Mode `prove` di `merkleCollector.js` (buktikan baris ke-i identik dengan yang
> direkam — verifikasi Merkle proof terhadap Merkle Root **on-chain**, hanya-baca,
> tanpa private key) dan mode `batch` di kedua collector (banyak `logId` dalam satu
> transaksi) dijelaskan di [`integration/README.md`](integration/README.md).

> ⚠️ Satu `logId` hanya boleh dikelola **satu** skrip backend. `logCollector.js`
> mengirim SHA-256 file utuh, `merkleCollector.js` mengirim Merkle Root — untuk
> file yang sama keduanya berbeda, jadi pengecekan silang = alarm palsu.

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
- [x] **v4.0** — registry aset on-chain dengan CRUD penuh (`createAsset` /
      `updateAsset` / `deleteAsset` / `getAsset`), RBAC diperluas ke data aset,
      event `AssetCreated`/`AssetUpdated`/`AssetDeleted`. Hash log tetap immutable.
      Menyusul: deploy ulang ke Sepolia + daftar role ulang di kontrak baru.
- [ ] **v4.0** (kalau waktu cukup) — hash disimpan sebagai `bytes32`
      (hemat gas signifikan dari penyimpanan string) + Merkle root per batch.

---

## ❓ FAQ

**Kenapa data user tidak disimpan di blockchain?**
Karena isinya data pribadi (nama, email) dan tidak perlu bisa diverifikasi publik.
Menyimpannya on-chain berarti membayar gas untuk setiap perubahan dan membuka data
itu untuk semua orang. Yang tetap on-chain adalah hal yang butuh *bukti*: hash log
(bukti log tidak diubah), role akun (bukti hak akses), dan registry aset.

**Bagaimana "login pakai wallet" bekerja?**
Tidak ada password. Dashboard meminta MetaMask membuka alamat (`eth_requestAccounts`),
lalu menanyakan role alamat itu ke kontrak (`getRoleName`). Alamat ber-role
`ADMIN`/`SOC_ANALYST`/`AUDITOR` boleh masuk; `NONE` ditolak. Untuk API off-chain,
pemanggil harus menandatangani pesan (`personal_sign`) yang memuat timestamp + nonce —
servernya lalu memverifikasi tanda tangan itu **dan** memeriksa role-nya lagi ke kontrak.

**Kalau aset bisa dihapus, apa bedanya dengan database biasa?**
Bedanya: penghapusan itu meninggalkan jejak permanen. `deleteAsset` membuang datanya
dari state (hemat gas baca), tetapi event `AssetDeleted(assetId, by, timestamp)`
tertinggal selamanya di blockchain — jadi selalu bisa dibuktikan bahwa data itu pernah
ada dan siapa yang menghapusnya. Di database biasa, `DELETE` sering berarti jejaknya
hilang.

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
