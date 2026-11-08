# 📍 STATUS PROYEK — checkpoint terakhir

Dokumen ini adalah **titik lanjut**. Kalau sesi baru dibuka, baca ini dulu: isinya
apa yang sudah jadi, bukti ujinya, cara menyalakan ulang, dan apa yang masih kurang.

**Checkpoint 3 — 8 November 2026** (dApp Development: requirement brief sudah
dipenuhi di kode; tinggal deploy ulang ke testnet).

| Item | Nilai |
|---|---|
| `main` terakhir | `640ac3f` (merge PR #13) |
| PR / issue terbuka | 0 / 0 |
| CI di `main` | ✅ hijau 3/3 (kontrak+backend, dashboard, stack) |
| Test | 22 kontrak · 59 backend+API · 16 smoke API |
| Kontrak Sepolia (LIVE) | `0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd` — **masih v3.0** |
| Kontrak versi kode | **v4.0.0** (registry aset + CRUD) |
| Stack lokal | jalan & sehat (chain, victim, collector, mongo, api, dashboard) |

---

## 1. Requirement brief → status

| # | Requirement dApp Development | Status | Di mana |
|---|---|---|---|
| 1 | On-chain data disimpan di blockchain | ✅ | `contracts/SIEMLogger.sol` (hash log, aset, role) |
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

Angka gas CRUD aset: create ~233k · update ~52k · delete ~60k (bahan laporan).

---

## 3. Cara menyalakan ulang (dari nol, 1 perintah)

```bash
cd D:/Projects/tamper-proof-siem-dapp
git checkout main && git pull origin main
cp .env.example .env                      # profil lokal tidak perlu diisi
docker compose --profile local up -d --build
```

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

1. 🔑 **Deploy ulang v4.0 ke Sepolia dari Remix** — kontrak live masih v3.0, jadi
   fitur registry aset & login-untuk-aset belum ada di testnet.
   Compile: Solidity `0.8.26` + optimizer `200` + EVM `paris`.
   Langkah lengkap: [`DEPLOY.md`](DEPLOY.md) bagian **"v4.0 — deploy ulang wajib"**.
2. 🔑 **Daftar role ULANG di kontrak baru** (role tidak ikut pindah saat redeploy):
   `addAnalyst(0x78ab74A8d8AA1490ECB3F806fE1e25f40DcF88a0)` (Yasin) ·
   `addAuditor(<alamat Nat>)` — alamat Nat masih ditunggu.
3. 🔑 Perbarui `deployments.json` (alamat + tx hash + tanggal) dan bagian alamat di
   `HANDOVER.md` / `README.md` (yang sekarang menyebut "(versi v3.0; v4.0 menyusul)").
4. Opsional: verifikasi kontrak di Etherscan · deploy ke Amoy (`deployments.json`
   slot `80002` masih kosong) · uji profil **Sepolia** pada `docker compose`.
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

Kontrak **tidak berubah** sejak v4.0.0 kecuali kalau ada perbaikan baru — kalau
mengubah `.sol`, jalankan `npm run export-abi` (ABI dicek CI) dan naikkan `VERSION`.
