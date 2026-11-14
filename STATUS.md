# 📍 STATUS PROYEK — checkpoint terakhir

Dokumen ini adalah **titik lanjut**. Kalau sesi baru dibuka, baca ini dulu: isinya
apa yang sudah jadi, bukti ujinya, cara menyalakan ulang, dan apa yang masih kurang.

**Checkpoint 5 — 14 November 2026** (dApp Development: requirement brief terpenuhi di
kode **dan sudah live di testnet** — kontrak v4.0 di Sepolia, 3 role terpasang, CRUD
aset + CRUD data user teruji; stack sekarang bisa dinyalakan 1 klik lewat `.bat`).

| Item | Nilai |
|---|---|
| `main` terakhir | `d39b3f7` (merge PR #16 — skrip pintasan `.bat` + dashboard mode Sepolia) |
| PR / issue terbuka | 0 / 0 |
| CI di `main` | ✅ hijau (3 workflow di `d39b3f7`: kontrak+backend, dashboard, stack) |
| Test | 22 kontrak · 59 backend+API · 16 smoke API |
| Kontrak Sepolia (LIVE) | `0x08129667d39d7e380Ac08d1359FeB5AD85b796e9` — **v4.0.0** (deploy 11 Nov 2026 10:04 WIB) |
| Role Sepolia | ADMIN `0x6BBd…e9297` · SOC_ANALYST `0x78ab…88a0` · AUDITOR `0x5B2f…a5d0` (akun uji, Nat menyusul) |
| Nyalakan stack | klik `jalankan-dashboard-sepolia.bat` (dashboard → kontrak Sepolia) atau `docker compose --profile local up -d` (chain lokal) |

---

## 1. Requirement brief → status

| # | Requirement dApp Development | Status | Di mana |
|---|---|---|---|
| 1 | On-chain data disimpan di blockchain | ✅ | `contracts/SIEMLogger.sol` (hash log, aset, role) — **live di Sepolia v4.0.0** |
| 2 | Tema aplikasi | ✅ | registry log anti-tamper + registry aset |
| 3 | Authorization ≥3 role | ✅ | `ADMIN` / `SOC_ANALYST` / `AUDITOR` (on-chain) |
| 4 | Authentication login pakai wallet address | ✅ | `Login.jsx` → `getRoleName(address)`; API off-chain verifikasi `personal_sign` |
| 5 | On-chain CRUD (insert/view/update/delete) | ✅ | registry aset: `createAsset`/`getAsset`/`updateAsset`/`deleteAsset` |
| 6 | Off-chain CRUD (insert/view/update/delete) | ✅ | `integration/backend/api/` (Express + MongoDB, data user) |

Peta lengkap + bukti ada di [`README.md`](README.md) bagian **"Peta Requirement Tugas → Implementasi"**.

**Catatan desain:** hash log sengaja **immutable** (tidak bisa update/delete) karena
itu inti nilai keamanan proyek. CRUD on-chain karena itu ditaruh di jenis data baru
(aset/inventaris) yang memang berubah — dan penghapusannya tetap meninggalkan event
permanen `AssetDeleted`.

---

## 2. Apa yang sudah jalan (bukti uji, bukan rencana)

| Uji | Hasil nyata |
|---|---|
| `npx hardhat test` | **22 passing** (RBAC, fungsi inti, CRUD aset, gas) |
| `npm run test:backend` | **59 passing** (40 collector + 19 API off-chain) |
| `node integration/backend/api/smoke-test.js` | **16/16 lulus** (401/403/409/201/200/404 end-to-end) |
| Dashboard, login ADMIN | `createAsset` 233.698 gas → `updateAsset` 52.325 → `deleteAsset` 59.978 |
| Dashboard, login SOC_ANALYST | tombol *hapus* mati, `createAsset` tetap jalan (216.402 gas) |
| Dashboard, login AUDITOR | semua tombol tulis mati (read-only) |
| Dashboard, mode hanya-baca | tabel + alarm tetap jalan, tulis mati |
| Pipeline log v4.0 | batch direkam (253.904 gas) → serangan hapus baris → `TamperingDetected` (52.452 gas) → banner 🚨 + 🔴 TAMPERED |
| CI | branch & `main` hijau 3/3 (termasuk cek ABI sinkron + validasi compose) |
| **Sepolia v4.0 (11 Nov 2026)** | kontrak `0x08129667…D85b796e9`, `VERSION()` = `4.0.0` dibaca dari chain; `getRoleName` → ADMIN / SOC_ANALYST / AUDITOR; `canManageAssets(AUDITOR)` = `false` |
| **CRUD aset di Sepolia** | `ASSET-001` create (1.022.303 gas) → update (69.350) → delete (108.913), lalu `getAssetCount` = `0` dan `getAsset('ASSET-001')` revert `AssetNotFound` |

Angka gas CRUD aset (chain lokal): create ~233k · update ~52k · delete ~60k. Di Sepolia
angkanya lebih besar (Remix menaksir gas limit tinggi): create 1.022.303 · update 69.350 ·
delete 108.913 — bahan laporan.

---

## 3. Cara menyalakan ulang (dari nol, 1 perintah)

> **Prasyarat:** Docker Desktop terpasang dan **sedang menyala** (icon di tray tidak
> berkedip). Kalau `docker` menjawab `failed to connect to the docker API … dockerDesktopLinuxEngine`,
> artinya Docker Desktop belum jalan — bukan masalah repo. Tunggu sampai engine siap
> (~1–3 menit setelah dibuka).

```bash
cd D:/Projects/tamper-proof-siem-dapp
git checkout main && git pull origin main
cp .env.example .env                      # profil lokal tidak perlu diisi
docker compose --profile local up -d
```

**Jangan tambah `--build`.** Registry Docker Hub tidak bisa dihubungi dari host ini
(`registry-1.docker.io` timeout) sehingga build selalu gagal di tahap load metadata.
Image `siem-app:local` / `siem-dashboard:local` / `mongo:7` sudah tersedia di lokal dan
dipakai langsung oleh `up -d`. Kalau kode berubah dan memang perlu build, akses registry
harus dibereskan dulu.

**Jalan pintas Windows (1 klik, hasil sama):** jalankan dari
`D:\Projects\tamper-proof-siem-dapp`

| File (klik dua kali) | Isi |
|---|---|
| `jalankan-dashboard-sepolia.bat` | `up -d` stack, lalu mengarahkan **dashboard ke kontrak v4.0 Sepolia** (`0x08129667…6e9`) |
| `matikan-stack.bat` | `docker compose down` **tanpa** menghapus data (chain, MongoDB, batch log tetap tersimpan) |

Dashboard mode Sepolia memakai override [`docker-compose.sepolia.yml`](docker-compose.sepolia.yml);
mode chain lokal cukup profil `local` tanpa override.

| Layanan | Alamat |
|---|---|
| Dashboard SOC | http://127.0.0.1:8088 |
| API off-chain | http://127.0.0.1:8089/api/health |
| RPC chain | http://127.0.0.1:8545 |
| SSH server korban | `ssh -p 2222 victim@127.0.0.1` (password `password123`) |

Deploy kontrak **otomatis**; alamatnya ditulis ke volume `/state` lalu dibaca
collector, API, dan dashboard (tidak ada salin-tempel manual).

**Uji cepat setelah nyala:**

```bash
NODE_ENV=development npm test                     # 22 test kontrak
NODE_ENV=development npm run test:backend         # 59 test (tanpa jaringan/DB)
NODE_ENV=development node integration/backend/api/smoke-test.js   # 16 pemeriksaan API
```

**Uji alarm (dari kondisi hijau):**

```bash
docker exec siem-victim sh -c 'f=$(ls /siem-batches/auth-*.log); sed -i "1d" "$f"'
sleep 40 && docker logs siem-collector | tail -5     # 🔴 TAMPERED + alarm on-chain
```

**Reset bersih:** `docker compose --profile local down -v` lalu hapus isi
`infra/siem-batches/` kecuali `.gitkeep`.

---

## 4. Sisa pekerjaan (titik lanjut berikutnya)

Urut prioritas. Tanda 🔑 = hanya bisa dikerjakan Vincent (butuh MetaMask/key sendiri).

1. ✅ **Deploy ulang v4.0 ke Sepolia — SELESAI 11 Nov 2026.** Kontrak
   `0x08129667d39d7e380Ac08d1359FeB5AD85b796e9` (v4.0.0), tx
   `0x55dcef0670a07e63b97e853c17b23c5175ab77740b3e024263a40775a1a5311a`.
   Fitur registry aset & RBAC sudah aktif di testnet; selector
   `createAsset`/`updateAsset`/`deleteAsset`/`getAsset*` terbukti ada di bytecode
   Sepolia. Catatan: deploy kali ini memakai **30.719.107 gas (~0.046 ETH)** —
   anomali yang sama seperti deploy v3.0 (14,16 juta gas), layak dibahas di laporan.
2. ✅ **Daftar role ULANG — SELESAI:** `addAnalyst(0x78ab74A8d8AA1490ECB3F806fE1e25f40DcF88a0)`
   (Yasin, SOC_ANALYST, blok 12108978) · `addAuditor(0x5B2f712b539171b1Ff4b6812AAB09A6F6b15a5d0)`
   (AUDITOR, blok 12108984 — **akun uji Vincent, sementara**).
   Sisa: begitu alamat **Nat (#6)** ada → `removeRole(0x5B2f…)` + `addAuditor(<alamat Nat>)`.
3. ✅ **Dokumen sudah diperbarui** (`deployments.json`, `HANDOVER.md`, `README.md`,
   `DEPLOY.md` + RPC `rpc.sepolia.org` yang 404 diganti `publicnode`).
   Bukti CRUD testnet: create `0xd058b32d…` → update `0xdc011de3…` → delete
   `0x4d3a6c7b…`, `getAssetCount` balik `0`, `getAsset('ASSET-001')` revert `AssetNotFound`.
4. Opsional: verifikasi kontrak di Etherscan (belum di-verify — tombolnya masih
   tersedia di halaman kontrak) · deploy ke Amoy (`deployments.json`
   slot `80002` masih kosong). ✅ Mode **Sepolia** pada dashboard sudah ada
   (PR #16: `docker-compose.sepolia.yml` + `jalankan-dashboard-sepolia.bat`).
5. Bukan bagian brief dApp, tapi jobdesk tim: skrip/skenario red team **Michael (#4)**
   dan laporan audit + CVSS **Nat (#6)** belum ada artefaknya di repo.
6. **Form pengumpulan belum keluar.** Begitu dikasih, cek formatnya (zip? link repo?
   alamat kontrak?) dan lampirkan: repo, `deployments.json`, alamat kontrak Sepolia,
   dan peta requirement di README.

---

## 5. Jebakan yang sudah menelan waktu (jangan diulang)

- **Satu `logId` = satu skrip backend.** `logCollector.js` (SHA-256 file) vs
  `merkleCollector.js` (Merkle Root) menghasilkan hash beda untuk file yang sama;
  collector sekarang menahan alarm dan mencetak `⚠️ SALAH SKRIP` kalau ini terjadi.
- **Jangan jalankan `infra/docker-compose.yml` (berdiri sendiri) bersamaan** dengan
  `docker-compose.yml` root — nama container, port 2222, dan folder `siem-batches` sama.
- **Chain restart tanpa `down -v`?** Kosongkan `infra/siem-batches/`; kalau tidak,
  collector masih menganggap batch lama terdaftar. Service `deploy` sudah idempoten
  (cek `eth_getCode`; kalau kontrak lama hilang ia deploy ulang dan menulis ulang `/state`).
- **Port host yang dipakai:** 8088 (dashboard), 8089 (API), 8545 (chain), 2222 (SSH korban).
  Kalau `up` gagal karena port terpakai, cari proses lamanya dulu (mis. `python -m http.server`).
- **Docker Desktop harus menyala lebih dulu.** Gejala kalau belum: semua perintah `docker`
  gagal dengan `failed to connect to the docker API at npipe:…dockerDesktopLinuxEngine`.
  Engine butuh ~1–3 menit setelah Docker Desktop dibuka.
- **Jangan pakai `up -d --build`.** `registry-1.docker.io` tidak terjangkau dari host ini,
  jadi build selalu berhenti di tahap load metadata. Pakai `up -d` biasa (image lokal sudah ada).
- **`.sh` wajib LF.** CRLF bikin shebang gagal di dalam container; CI menolaknya.
- **`main` dilindungi ruleset** → semua perubahan lewat branch + PR. `gh` belum login;
  buka/merge PR memakai token dari `git credential fill` lalu GitHub REST API
  (pola ini sudah dipakai untuk PR #8–#13).
- **CI tidak membandingkan bytecode** — metadata (hash IPFS) berubah kalau line ending
  file sumber beda (Windows CRLF vs runner LF). Yang dicek hanya ABI.

---

## 6. Riwayat commit penting

| Commit / PR | Isi |
|---|---|
| `43baa0a`, `caa0d8e` (PR #8) | perbaikan infra server korban (#3 Rafif) |
| `cc23892` (PR #9) | `collectorService.js` — daemon batch → on-chain + alarm berkala |
| `36b92b2` (PR #10) | SOC Dashboard React + Vite (#5 Joseph) |
| `5246f1b` (PR #11) | stack gabungan `docker compose` + perbaikan dashboard/alamat kontrak |
| `9693d4f` (PR #12) | `STATUS.md` (dokumen ini) |
| `fce914f` (PR #13) | **v4.0**: registry aset (CRUD on-chain) + API off-chain + login wallet |
| `29e18c7` | CI: cek drift hanya untuk ABI |
| `e3bf713`, `ff394a9` (PR #14) | `STATUS.md` jadi checkpoint "titik lanjut" |
| `b929897` (PR #15) | dokumen: kontrak v4.0 LIVE di Sepolia — alamat baru, role, bukti CRUD testnet |
| `d39b3f7` (PR #16) | skrip pintasan `jalankan-dashboard-sepolia.bat` / `matikan-stack.bat` + override dashboard mode Sepolia |

Kontrak **tidak berubah** sejak v4.0.0 kecuali kalau ada perbaikan baru — kalau
mengubah `.sol`, jalankan `npm run export-abi` (ABI dicek CI) dan naikkan `VERSION`.
