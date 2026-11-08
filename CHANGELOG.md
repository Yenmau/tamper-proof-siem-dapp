# CHANGELOG — `contracts/SIEMLogger.sol`

Semua perubahan penting pada smart contract. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/), versi mengikuti
[SemVer](https://semver.org/).

---

## [Unreleased] — stack gabungan `docker compose` + perbaikan dashboard

`contracts/SIEMLogger.sol` **tidak disentuh**; ABI, bytecode, dan alamat Sepolia
tetap sama. Yang berubah hanya pembungkusan & tampilan.

### Added

- **`docker-compose.yml` di root** — satu perintah menyalakan seluruh alur:
  `chain` (Hardhat) -> `deploy` (deploy kontrak, alamat ditulis ke volume `/state`)
  -> `victim-server` (#3) -> `collector` (#2) -> `dashboard` (#5).
  Dua profil: `local` (semua di dalam Docker) dan default (pakai kontrak Sepolia
  yang sudah live, tanpa chain lokal).
- `docker/app.Dockerfile`, `docker/deploy-entrypoint.sh`,
  `docker/collector-entrypoint.sh`, `.dockerignore`, `.env.example` (root).
- CI: job **Validasi stack docker compose** — menolak skrip `.sh` yang ber-CRLF
  atau syntax-nya salah, dan memvalidasi `docker compose config` untuk kedua profil.

### Fixed

- **Alamat kontrak tidak sampai ke dashboard.** Dockerfile frontend hanya
  men-`COPY` `40-siem-config.sh`, sedangkan skrip pengambil alamat dari
  `/state` (`35-siem-address.sh`) tidak pernah ikut — dan karena entrypoint nginx
  menjalankan setiap `*.sh` sebagai proses anak, `export` dari skrip terpisah juga
  tidak akan terbaca. Sekarang pembacaan `/state/contract-address.txt` dilakukan
  langsung di dalam `40-siem-config.sh`, dan seluruh folder `docker-entrypoint.d/`
  ikut ter-`COPY`. Terbukti: `config.json` container berisi alamat hasil deploy.
- **RPC untuk browser salah alamat.** `docker-compose.yml` mengisi `RPC_URL` dengan
  `http://chain:8545` (nama service Docker) untuk dashboard, padahal yang memanggil
  RPC adalah browser di host -> koneksi gagal. Dashboard kini memakai
  `BROWSER_RPC_URL` (default `http://127.0.0.1:8545`; untuk Sepolia diisi URL publik).
- **Panel bukti Merkle menampilkan hasil basi.** Setelah backend mendeteksi log
  diubah, panel masih memperlihatkan klaim lama "N baris TERBUKTI identik".
  Hasil sekarang dibuang saat `logId` berganti atau saat backend memeriksa ulang
  log tersebut (`verifiedAt`/`isTampered` berubah), dan setiap hasil diberi
  keterangan waktu verifikasi.
- `hardhat.config.js`: network `localhost` mengikuti `RPC_URL` supaya
  `scripts/deploy.js` bisa dipakai dari dalam container.
- Dokumentasi: `README.md` (bagian Jalankan Seluruh Stack), `integration/README.md`,
  `integration/frontend/README.md`, dan `infra/README.md` (peringatan agar tidak
  menjalankan compose infra berdiri sendiri bersamaan dengan compose root).

### Verified

- `docker compose --profile local up -d --build` dari nol: chain healthy, kontrak
  ter-deploy (`0x5FbDB2315678afecb367f032d93F642f64180aa3`), server korban healthy,
  collector merekam batch (`rekam victim-server/auth-... (2 baris)`, 1 transaksi
  batch, 253.838 gas).
- Simulasi serangan (satu baris log dihapus di server korban): collector
  mendeteksi `TAMPERED`, mengirim `verifyLogIntegrity` (52.429 gas), event
  `TamperingDetected` muncul; dashboard menampilkan banner **TAMPERING DETECTED**
  + judul tab berkedip, badge TAMPERED, dan panel bukti Merkle melaporkan
  `2 dari 2 baris TIDAK TERBUKTI` (dihitung di browser terhadap root on-chain).

---


## [Unreleased] — fitur & perapian `integration/backend` (bukan perubahan kontrak)

`contracts/SIEMLogger.sol` **tidak disentuh**; ABI, bytecode, dan alamat Sepolia
tetap sama. Bagian ini mencatat perubahan di sekitarnya supaya jejaknya jelas.

### Added — SOC Dashboard React + Vite (jobdesk #5)

- `integration/frontend/` diganti dari dashboard satu-file menjadi aplikasi
  **React 18 + Vite + Tailwind**: `src/App.jsx`, `src/lib/{config,contract,merkle,format}.js`,
  `src/components/{Header,StatCards,LogTable,LogDetail,ProofPanel,AlarmBanner,EventStream}.jsx`.
  Versi lama tetap disimpan sebagai `frontend/legacy-dashboard.html`.
- **Jalan tanpa MetaMask**: provider RPC hanya-baca untuk registry + event;
  tombol connect wallet opsional (badge role).
- **Verifikasi Merkle proof di browser** (WebCrypto SHA-256, tanpa backend): panel
  per log memeriksa tiap baris terhadap Merkle Root on-chain, plus cek ulang gratis
  `verifyLogIntegrityView` atas root yang dihitung di browser. Algoritma
  diuji silang dengan `merkletreejs` (hasil identik).
- Filter + export CSV, statistik (total/aman/tampered/alarm), event stream
  (`TamperingDetected`, `LogRecorded`, `LogVerified`), judul tab berkedip.
- `Dockerfile` (build → nginx) + `nginx.conf` yang menyajikan `/data` (folder batch
  + artefak bukti, read-only) + `docker-entrypoint.d/40-siem-config.sh` yang menulis
  `config.json` dari env sehingga satu image dipakai untuk chain lokal maupun Sepolia.

### Added — `collectorService.js` (batch log → on-chain, otomatis)

- **Daemon baru** `integration/backend/collectorService.js`: membaca `index.ndjson`
  hasil log-shipper (#3), merekam batch yang belum terdaftar (beberapa batch
  sekaligus dalam satu `recordLogHashBatch` — terukur 218.226 vs 253.838 gas/batch),
  lalu mengecek ulang integritas tiap `VERIFY_INTERVAL_MS` lewat
  `verifyLogIntegrityView` (gratis) dan hanya mengirim transaksi alarm kalau
  memang berbeda atau file hilang.
- `lib/batch-queue.js` — logika antrean (parse index, batch pending, jadwal
  verifikasi, update state) dipisah supaya murni dan bisa diuji tanpa jaringan;
  **12 unit test** baru (`test/batch-queue.test.js`, total backend 40 test).
- State disimpan di `<BATCH_DIR>/.collector-state.json` secara atomik (`.tmp` +
  `rename`); batch yang sudah `tampered` tidak dicek ulang karena flag on-chain
  satu arah (hemat gas).
- `npm run collector` sebagai jalan pintas, `--once` untuk satu putaran (uji/CI).
- Diuji end-to-end: batch dari server korban direkam otomatis; isi batch diubah →
  `TamperingDetected` (52.429 gas); batch dihapus → alarm dengan
  `0x__LOG_FILE_MISSING__` (50.441 gas); 3 batch baru → 1 transaksi.

### Added — Merkle proof per baris + batch record (menutup sisa pekerjaan #2)

- **Merkle proof per baris.** Sebelumnya klaim "baris ke-i tidak berubah" hanya
  berasal dari perbandingan teks dengan salinan MongoDB — padahal DB off-chain itu
  sendiri bisa ditulis ulang penyerang. Sekarang `record` menyimpan **proof**
  (jalur sibling hash) untuk tiap baris, dan mode baru
  `prove <fileLog> <logId> [indexBaris]` memverifikasi proof tersebut terhadap
  **Merkle Root on-chain**: baris yang cocok TERBUKTI identik, baris yang diubah
  terbukti berbeda. Mode ini **hanya-baca** (tanpa `PRIVATE_KEY`), tanpa MongoDB,
  dan fail-closed kalau artefak bukti diubah. Diuji end-to-end di node lokal:
  file diubah di baris ke-2 → `prove` melaporkan baris 0 & 2 tetap terbukti,
  baris 1 gagal (exit code 1).
- **Artefak bukti `<fileLog>.<logId>.proofs.json`** selalu ditulis saat `record`
  dan `batch` (MongoDB tidak wajib). Nama file memuat `logId` supaya pola rotasi
  (`auth.log#2026-10-09` vs `auth.log#2026-10-10`) tidak saling menimpa; `logId`
  di-*slug* agar tidak bisa keluar dari folder (path traversal).
- **Mode `batch <manifest.txt>`** di `logCollector.js` **dan** `merkleCollector.js`:
  banyak `logId` dalam satu transaksi `recordLogHashBatch`. Manifest = teks,
  `<logId> <path file log>` per baris, `#` untuk komentar. `logId` yang sudah
  terdaftar on-chain serta file yang hilang/kosong disaring lebih dulu lewat
  pemanggilan `view` (gratis), karena kontrak bersifat *all-or-nothing*. Gas
  terukur di node lokal: 173.122 vs 208.756 gas per log untuk 3 log (hemat ~17%).
- `lib/collector-core.js` bertambah: `leafHash`/`leafHashHex`, `merkleProofOfLine`,
  `verifyLineProof`, `buildProofArtifacts`, `saveProofArtifacts`,
  `loadProofArtifacts`, `slugLogId`, `proofsPathFor`, `parseManifest`,
  `prepareBatchEntries`, `connectReadOnly`, `onChainEntry`.
- Skema MongoDB `logbatches` menyimpan `lines[].proof` + `algorithm`.
- Unit test backend **13 → 28** (proof per baris, artefak, manifest, batch),
  semuanya tanpa jaringan/MongoDB.
- `.gitignore`: `*.proofs.json` (artefak runtime collector).

### Fixed

- **`integration/backend/.env.example` rusak encoding.** Baris `MONGO_URI`
  ter-*append* sebagai UTF-16LE (pola khas `>>` di PowerShell), sehingga file
  jadi binary (`file` → `data`) dan variabelnya tidak terbaca. Ditulis ulang
  sebagai UTF-8; CI sekarang **menolak** file ini kalau kembali non-UTF-8.
- **`logCollector.js` tidak memuat `.env` sama sekali**, padahal
  `integration/README.md` menyuruh `cp .env.example .env` — akibatnya
  `❌ ENV CONTRACT_ADDRESS belum di-set` walau `.env` sudah diisi. Sekarang
  membaca `integration/backend/.env` **relatif ke lokasi skrip**, jadi skrip
  bisa dijalankan dari root repo tanpa `export` manual.
- **`merkleCollector.js` memuat `.env` relatif current working directory**
  (`require('dotenv').config()`), sehingga hanya jalan kalau di-`cd` dulu ke
  `integration/backend`. Ikut diperbaiki dengan pola yang sama.
- **`ethers` ada di `devDependencies`** padahal dipakai saat *runtime* oleh
  kedua skrip backend → di server dengan `npm ci --omit=dev` /
  `NODE_ENV=production` collector mati dengan `MODULE_NOT_FOUND: ethers`.
  Dipindah ke `dependencies`.

### Added

- **`.github/workflows/ci.yml`** — menjalankan 15 test kontrak (`npm test`),
  syntax check skrip backend, dan penjaga encoding `.env.example`.
- `npm run lint:backend`.
- Dokumentasi: jalur Merkle kini tercatat di `README.md`, `HANDOVER.md`, dan
  `integration/README.md`; batasan jalur Merkle (wajib MongoDB, `watch` sekali
  jalan, root `"0x"` untuk file kosong, baris mentah plaintext di Mongo, Merkle
  proof belum ada) dicatat di `integration/backend/README_MERKLE.md`.

### Changed — rapikan kode backend (algoritma TIDAK berubah)

- Utilitas yang sama dipindah ke `integration/backend/lib/collector-core.js`
  (`die`, `loadAbi`, `sha256`, `explainError`, `connect`, `explorerLink`,
  penanganan file hilang). Sebelumnya ~60% kode kedua skrip duplikat.
- `merkleCollector.js` sekarang ber-CLI sama dengan `logCollector.js`:
  `watch <file> <logId> [intervalDetik] [maxIterasi]` (dulu hanya sekali cek),
  jadi bisa dipakai sebagai daemon — default 5 detik, `0` = jalan terus.
- **MongoDB jadi opsional** untuk `merkleCollector.js`: `MONGO_URI` kosong
  (default di `.env.example`) atau flag `--no-db` → skrip tetap jalan tanpa DB;
  yang hilang hanya perbandingan baris demi baris.
- **Baru: deteksi "salah skrip".** Sebelum mengirim alarm, `logHash` on-chain
  dibandingkan dengan hasil hitung mode lain untuk file yang sama. Kalau cocok,
  skrip mencetak `⚠️ SALAH SKRIP` dan **menahan transaksi** — supaya
  `isTampered` tidak tercemar alarm palsu (flag itu satu arah, tidak bisa
  dikembalikan ke `false`).
- **File tanpa baris berisi tidak lagi menghasilkan root `"0x"`** (dulu semua
  log kosong bisa ber-hash sama, dan fallback `|| "0x000…0"` tidak pernah jalan
  karena `"0x"` truthy): `record` menolak dengan pesan jelas, `watch`
  mengirim penanda `0x__LOG_FILE_EMPTY__`, dan panjang root diverifikasi dulu
  (harus 66 karakter) sebelum dikirim.
- Unit test backend: `npm run test:backend` (28 test, tanpa jaringan/MongoDB),
  ditambahkan sebagai langkah di CI.

### Known issues (belum diperbaiki, sengaja didokumentasikan)

- Satu `logId` tetap hanya boleh dikelola satu skrip: kontrak menyimpan satu
  nilai `logHash`, jadi tidak ada tempat untuk menandai mode hashing. Salah
  skrip kini terdeteksi otomatis, tetapi pencegahan idealnya di sisi #2
  (mis. menandai mode di dalam `logId`).
- **Merkle proof per baris belum dibuat/diverifikasi** — kemampuan "menunjukkan
  baris mana yang diubah" masih berasal dari perbandingan teks dengan salinan
  MongoDB, belum bukti kriptografis.
- Baris log mentah disimpan plaintext di MongoDB (bisa ditulis ulang penyerang;
  penjaga integritas yang sebenarnya tetap Merkle Root on-chain).
- `recordLogHashBatch` belum dipakai collector (masih TODO #2).

---

## [3.0.0] — 2026-10-09

**Sifat rilis: backward compatible untuk 3 fungsi inti.**

Menambahkan **RBAC 3 role** sesuai pembagian tugas tim
(`Admin`, `SOC Analyst`, `Auditor`). Sebelumnya hanya ada satu level akses
(admin tunggal), sehingga syarat "mengatur akses otorisasi 3 role" di brief
belum terpenuhi.

### Matriks izin

| Role | Nilai enum | Tulis log (`recordLogHash`) | Verifikasi + alarm (`verifyLogIntegrity`) | Verifikasi gratis (`verifyLogIntegrityView`) | Kelola role |
|---|---|---|---|---|---|
| `ADMIN` | 3 | ✅ | ✅ | ✅ | ✅ |
| `SOC_ANALYST` | 2 | ✅ | ✅ | ✅ | ❌ |
| `AUDITOR` | 1 | ❌ | ❌ | ✅ | ❌ |
| `NONE` (publik) | 0 | ❌ | ❌ | ✅ (baca publik) | ❌ |

**Alasan `AUDITOR` sengaja read-only** — prinsip *separation of duties*:
auditor tidak boleh punya kemampuan mengubah data yang dia audit, karena
hasil auditnya jadi tidak bernilai kalau dia sendiri bisa menulis/menghapus.
Auditor tetap bisa membuktikan integritas sendiri lewat
`verifyLogIntegrityView` (view, 0 gas).

### Added

- `enum Role { NONE, AUDITOR, SOC_ANALYST, ADMIN }` + `mapping(address => Role) public roles`.
- `setRole(address, Role)` — set role generik (hanya ADMIN).
- `removeRole(address)` — cabut akses tulis (kembali `NONE`).
- Shortcut: `addAnalyst(address)`, `addAuditor(address)`.
- Query: `getRoleName(address)` → `"ADMIN"` / `"SOC_ANALYST"` / `"AUDITOR"` / `"NONE"`,
  `isOperator(address)`, `hasRole(address)`.
- Event `RoleAssigned(address, Role)` dan `RoleRevoked(address, Role)`.
- Modifier baru `onlyOperator` (SOC_ANALYST atau ADMIN).

### Changed

- `addAdmin` / `removeAdmin` (dari v2.0) **tetap ada**, sekarang hanya alias
  dari `setRole(account, ADMIN)` / `removeRole(account)`.
- `isAdmin(address)` diubah dari *public mapping* menjadi *view function*.
  **ABI-nya identik** (selector & return type sama), jadi pemanggil tidak
  terpengaruh.
- `recordLogHash`, `recordLogHashBatch`, `verifyLogIntegrity` sekarang memakai
  modifier `onlyOperator` (sebelumnya `onlyAdmin`). Artinya **SOC_ANALYST juga
  bisa menulis log** — sesuai perannya sebagai operator harian.
- Role management (`setRole`, `removeRole`, `add*`, `removeAdmin`) sekarang
  butuh role `ADMIN` (sebelumnya `onlyOwner`). Owner otomatis ADMIN, dan owner
  sendiri **tidak bisa** diubah/dicabut (`CannotChangeOwner`).
- Error baru: `NotOperator`, `InvalidRole`, `SameRole(account, role)`,
  `CannotChangeOwner`. `AlreadyAdmin` dihapus (digantikan `SameRole`).
- **Event `LogRecorded`, `LogVerified`, `TamperingDetected`: parameter `logId`
  tidak lagi `indexed`.** Alasannya: `indexed` pada `string` hanya menyimpan
  **hash** dari string itu, sehingga isi `logId` **tidak bisa dibaca kembali**
  dari event. Akibatnya dashboard SOC tidak akan tahu log mana yang di-tamper
  (bug ini ketemu saat pengujian end-to-end, bukan dari teori).
  Setelah diperbaiki, frontend bisa langsung membaca
  `event.args[0] === "auth.log#2026-10-09"`.
  - Biaya: +≈440 gas saat `recordLogHash` (data log cuma 8 gas/byte, berbeda
    jauh dari 20k gas/slot storage) — jauh lebih murah daripada manfaatnya.
  - Trade-off: filter per-`logId` di sisi server (topic filter) digantikan
    penyaringan di sisi klien. Tidak masalah untuk skala proyek ini.

### Gas (diukur dari `npm test`, Solidity 0.8.26, optimizer runs 200, evm paris)

| Operasi | Gas |
|---|---|
| `recordLogHash` — 1 log, 1 transaksi | **208.708** |
| `recordLogHashBatch` — 5 log, 1 transaksi | **845.333** (≈ **169.066 / log**) |
| `verifyLogIntegrity` — hash cocok | **45.701** |
| `verifyLogIntegrityView` — hash cocok | **0** (view, gratis) |
| Bytecode hasil compile | 8.948 byte |

> Penambahan RBAC (mapping role + pengecekan modifier) hanya menambah
> **±135 gas** per pemanggilan tulis dibanding v2.0 — jauh lebih murah daripada
> biaya yang dihemat oleh optimasi v2.0 (±39.530 gas/log dari batch).

---

## [2.0.0] — 2026-10-09

**Sifat rilis: backward compatible (superset).**
Tiga fungsi inti v1.0 **tidak berubah nama maupun signature-nya**, jadi kode
Yasin (backend) dan Joseph (frontend) yang sudah dibuat berdasarkan v1.0 tetap
jalan tanpa diubah.

| Fungsi inti | Signature v1.0 | Signature v2.0 | Berubah? |
|---|---|---|---|
| `recordLogHash` | `(string,string)` | `(string,string)` | tidak |
| `verifyLogIntegrity` | `(string,string) returns (bool)` | sama | tidak |
| `getLogStatus` | `(string) view returns (string,uint256,bool)` | sama | tidak |

### Security

- **FIX — `verifyLogIntegrity` sekarang `onlyAdmin`.**
  Di v1.0 fungsi ini bisa dipanggil siapa saja dan langsung menulis
  `isTampered = true` kalau hash-nya beda. Akibatnya orang luar bisa
  **mengirim hash ngawur untuk memicu alarm palsu** (false alarm) dan
  mencemari status log — flag `isTampered` tidak bisa dibalik ke `false`.
  Sekarang hanya admin yang boleh menulis status tamper.
- **NEW — `verifyLogIntegrityView(logId, hash)`**: versi `view` (gratis, tanpa
  gas, tanpa ubah state) untuk pengecekan rutin. Ini jalur yang dipakai
  frontend untuk badge status, dan backend untuk polling sebelum memutuskan
  apakah perlu kirim transaksi alarm.
- **NEW — proteksi owner**: `admin` (akun deployer) tidak bisa dicabut lewat
  `removeAdmin` → mencegah skenario "kehilangan semua admin".
- **NEW — validasi**: hash kosong ditolak (`EmptyHash`), `address(0)` ditolak
  (`InvalidAddress`), panjang array batch harus sama (`LengthMismatch`).

### Added

- **Multi-admin** (permintaan fitur v2.0 di brief):
  `isAdmin(address)`, `adminCount()`, `addAdmin(address)`,
  `removeAdmin(address)`, `getAdmins()`.
  Berguna supaya server backend punya akun adminnya sendiri tanpa harus
  memakai akun pribadi Vincent.
  - `admin` = owner/deployer → hanya dia yang bisa tambah/hapus admin.
  - `onlyAdmin` sekarang cek `isAdmin[msg.sender]`, bukan `msg.sender == admin`.
- **`recordLogHashBatch(string[] ids, string[] hashes)`** — impor banyak log
  dalam 1 transaksi → biaya dasar transaksi (±21k gas) dibagi ke semua item.
- **`getLogEntry(logId)`** — ambil seluruh field sekaligus
  `(logHash, timestamp, verifiedAt, isTampered, recordedBy)`.
- **`getLogCount()`, `getLogIds()`, `getLogIdAt(i)`** — supaya UI bisa
  menampilkan daftar seluruh log tanpa perlu indexer.
- **Event baru** (additive — listener lama tidak terganggu):
  - `LogVerified(logId, currentHash, isMatch, timestamp)` → frontend dapat
    konfirmasi positif, bukan cuma alarm.
  - `AdminAdded(account)`, `AdminRemoved(account)`.
- **Field baru di struct `LogEntry`**:
  `verifiedAt (uint64)` dan `recordedBy (address)`.
- **`VERSION`** — konstanta string `"2.0.0"`, bisa ditampilkan di UI.
- **Custom error** menggantikan `require` dengan string.

### Changed (perlu diketahui tim)

- **Nama kontrak: `SIEM` → `SIEMLogger`** (mengikuti nama file & brief).
  Ini **tidak mengubah ABI** — hanya nama yang muncul di Remix.
- **Getter publik `logs(logId)` sekarang mengembalikan 5 nilai**:
  `(string, uint256, uint64, bool, address)` — sebelumnya 3.
  Kalau mau 3 nilai seperti dulu, pakai `getLogStatus(logId)`.
- **Pesan error berubah bentuk**: dari `require` + string
  (`"Log ID sudah terdaftar!"`) menjadi **custom error**
  (`LogAlreadyExists(logId)`). Di ethers v6, tangkap lewat
  `err.revert.name` / `contract.interface.parseError(err.data)`.
- **`recordLogHash` dkk. sekarang `external` + parameter `calldata`**
  (dulu `public` + `memory`). Selector / ABI **sama**, hanya lebih hemat gas.
- **Pengecekan `verifyLogIntegrity` butuh akun admin** — Yasin harus mengirim
  transaksi dari akun yang sudah di-`addAdmin`, bukan akun sembarang.

### Gas (diukur, bukan estimasi)

Hasil `npm test` (Solidity 0.8.26, optimizer runs 200, evm `paris`):

| Operasi | Gas |
|---|---|
| `recordLogHash` — 1 log, 1 transaksi | **208.134** |
| `recordLogHashBatch` — 5 log, 1 transaksi | **843.023** (≈ **168.604 / log**) |
| `verifyLogIntegrity` — hash cocok | **45.161** |
| `verifyLogIntegrityView` — hash cocok | **0** (view, gratis) |
| Hemat dari batch | **≈ 39.530 gas per log** (19%) |

Optimasi yang dipakai:
1. `calldata` menggantikan `memory` pada parameter eksternal.
2. Custom error menggantikan string `require` (lebih murah saat revert dan
   saat deploy karena string tidak disimpan di bytecode).
3. Paket struct: `verifiedAt (8B) + isTampered (1B) + recordedBy (20B) = 29
   byte` → masuk **1 slot** storage. Kalau ditulis sebagai field terpisah
   (uint256 + bool + address) butuh **3 slot**.
4. `recordLogHashBatch` mengamortisasi biaya dasar transaksi ke banyak log.
5. Menyediakan jalur `view` gratis supaya polling tidak perlu bayar gas.

> Catatan jujur untuk laporan: porsi gas terbesar tetap berasal dari
> **penyimpanan string hash on-chain** (string = 1 slot + data). Optimasi
> berikutnya di v3.0 adalah menyimpan hash sebagai **`bytes32`** (satu setengah
> slot) — tapi itu akan mengubah ABI, jadi jangan dilakukan di tengah proyek.

### Breaking changes

Tidak ada untuk 3 fungsi inti. Yang berubah hanya:
1. nama kontrak (`SIEM` → `SIEMLogger`),
2. tuple getter `logs()` dari 3 → 5 nilai,
3. bentuk revert (string → custom error),
4. `verifyLogIntegrity` butuh admin.

---

## [1.0.0] — versi awal

- File `contracts/SIEMLogger.sol` diunggah ke folder `contracts/`.
- Kontrak `SIEM` dengan `struct LogEntry { string logHash; uint256 timestamp;
  bool isTampered; }`.
- `recordLogHash(string _logId, string _logHash)` — `onlyAdmin`, revert kalau
  logId sudah ada.
- `verifyLogIntegrity(string _logId, string _currentServerHash) returns (bool)`
  — membandingkan `keccak256(abi.encodePacked(...))`, menulis
  `isTampered = true` dan emit `TamperingDetected` kalau beda.
- `getLogStatus(string _logId) view returns (string, uint256, bool)`.
- Event: `LogRecorded`, `TamperingDetected`.
- Admin tunggal = akun deployer.
