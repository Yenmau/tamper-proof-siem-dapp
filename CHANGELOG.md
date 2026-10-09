# CHANGELOG — `contracts/SIEMLogger.sol`

Semua perubahan penting pada smart contract. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/), versi mengikuti
[SemVer](https://semver.org/).

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
