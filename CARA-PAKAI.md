# Panduan Penggunaan — Tamper-Proof SIEM dApp

Dokumen ini untuk penilai: cara menjalankan aplikasi, cara memakai tiap fitur, cara
membuktikan sendiri hasilnya, sampai daftar masalah yang biasa muncul.

| Item | Nilai |
|---|---|
| Repository | `https://github.com/Yenmau/tamper-proof-siem-dapp` (branch `main`, publik) |
| Kontrak live (testnet) | Sepolia `0x08129667d39d7e380Ac08d1359FeB5AD85b796e9` — **v4.0.0** (deploy 11 Nov 2026 10:04 WIB, blok 12.108.967) |
| Cara akses | Dijalankan lokal lewat Docker (tidak ada server publik) — lihat Bab 2 |
| Versi dokumen | 15 November 2026 |

---

## 1. Aplikasi ini apa dan mengapa

Log server adalah bukti forensik utama, tetapi log disimpan di server yang sama dengan yang
diserang: penyerang yang punya akses root bisa mengubah atau menghapus baris log untuk
menghilangkan jejak, dan tidak ada cara membuktikan log sudah dirusak.

Aplikasi ini memindahkan bukti integritasnya ke luar server korban. Tiap berkas log ditandai
**hash SHA-256** (atau **Merkle root** per baris), lalu hash itu dikunci di smart contract
Ethereum. Blockchain menyimpan hash itu sebagai state permanen yang tidak bisa ditimpa. Sistem
secara berkala menghitung ulang hash berkas di server; kalau tidak lagi sama dengan yang
dikunci on-chain, kontrak memancarkan event `TamperingDetected` dan dashboard SOC menaikkan
alarm real-time lengkap dengan perbandingan hash asli vs hash server.

| Jenis data | Lokasi | Operasi |
|---|---|---|
| Hash log | On-chain (registry log) | Insert + view saja — **sengaja immutable**; membuka update/delete pada hash akan menghapus inti nilai keamanannya. Penghapusan log justru terdeteksi sebagai perbedaan hash. |
| Registry aset/inventaris | On-chain (registry aset) | **CRUD penuh**: `createAsset`, `getAsset`, `updateAsset`, `deleteAsset`. Penghapusan tetap meninggalkan event permanen `AssetDeleted`. |
| Data user (nama, email, departemen) | Off-chain (MongoDB + REST API Express) | **CRUD penuh**: `POST/GET/PUT/DELETE /api/users`. Data pribadi tidak dibayar gas dan tidak perlu publik. |
| Role akun (ADMIN, SOC_ANALYST, AUDITOR) | On-chain | Dibaca saat login untuk menentukan siapa boleh menulis, mengubah, atau menghapus. |

---

## 2. Cara menjalankan aplikasi

Seluruh sistem (server korban simulasi, collector log, MongoDB, REST API, dashboard SOC)
dibungkus Docker Compose — tidak ada instalasi manual selain Docker Desktop.

### 2.1 Prasyarat

- Windows / macOS / Linux + Docker Desktop terpasang dan berjalan.
- Koneksi internet (mengambil image container; pada mode testnet juga untuk membaca kontrak Sepolia).
- Ruang disk ± 2 GB dan port **8088, 8089, 8545, 2222** bebas.

### 2.2 Langkah menjalankan (≤ 2 menit)

Ada dua mode; stack yang dijalankan sama, yang berbeda hanya kontrak mana yang dibaca dashboard.

| Mode | File yang diklik dua kali | Dipakai untuk |
|---|---|---|
| Chain lokal (chainId 31337) | `jalankan-stack-lokal.bat` | **Demo alarm tampering** end-to-end: log direkam → dirusak → alarm muncul |
| Sepolia (testnet publik) | `jalankan-dashboard-sepolia.bat` | Menunjukkan kontrak v4.0.0 yang asli di testnet (tabel biasanya kosong karena collector menulis ke chain lokal — normal) |
| Mematikan stack | `matikan-stack.bat` | Berhenti kerja; data tidak dihapus |

1. Nyalakan **Docker Desktop**, tunggu ikon paus berhenti berkedip (± 1–3 menit).
2. Ambil repo dan siapkan env:

   ```bash
   git clone https://github.com/Yenmau/tamper-proof-siem-dapp.git
   cd tamper-proof-siem-dapp
   cp .env.example .env
   ```

3. Klik dua kali `jalankan-stack-lokal.bat` (demo alarm) atau `jalankan-dashboard-sepolia.bat`
   (kontrak testnet). Setara lewat terminal:

   ```bash
   docker compose --profile local up -d
   ```

4. Tunggu tulisan `Selesai. Buka: http://127.0.0.1:8088` (± 30–60 detik), tekan sembarang tombol.
5. Buka browser → `http://127.0.0.1:8088`.

> Kalau aplikasi dibuka pada hari lain setelah chain pernah dimatikan, jalankan langkah 3 sekali
> lagi: chain lokal tidak menyimpan state, jadi kontrak perlu di-deploy ulang. Service `deploy`
> bersifat idempoten (cek kontrak → deploy kalau kosong → tulis alamatnya), jadi tidak ada risiko
> data ganda.

### 2.3 Alamat akses setelah stack jalan

| Layanan | Alamat |
|---|---|
| Dashboard SOC | `http://127.0.0.1:8088` |
| REST API off-chain (data user) | `http://127.0.0.1:8089/api/health` |
| Node blockchain lokal (RPC) | `http://127.0.0.1:8545` |
| Server korban simulasi (SSH) | `ssh -p 2222 victim@127.0.0.1` (password `password123`) |

### 2.4 Masuk ke dashboard

| Cara masuk | Untuk apa | Bisa menulis? |
|---|---|---|
| **Login dengan Wallet** (MetaMask) | Autentikasi sesungguhnya: wallet diminta membuka akun (`eth_requestAccounts`), lalu role dibaca on-chain lewat `getRoleName(address)`. Alamat tanpa role ditolak. | Ya, sesuai role |
| **Masuk sebagai alamat ini** | Menempel alamat publik tanpa wallet — praktis untuk memeriksa registry aset. | Tidak (hanya-baca) |
| **Masuk tanpa wallet (hanya-baca)** | Melihat tabel log + banner alarm tanpa ekstensi wallet. | Tidak |

Akun ber-role pada kontrak Sepolia v4.0.0:

| Role | Alamat | Hak |
|---|---|---|
| ADMIN (owner) | `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` | Semua operasi: tambah/ubah/hapus aset, kelola role |
| SOC_ANALYST | `0x78ab74A8d8AA1490ECB3F806fE1e25f40DcF88a0` | Tambah & ubah aset; tidak boleh menghapus |
| AUDITOR | `0x5B2f712b539171b1Ff4b6812AAB09A6F6b15a5d0` | Hanya melihat (read-only) |

Alamat tanpa role akan ditolak saat login — bukti otorisasi ditegakkan di kontrak, bukan hanya di tampilan.

---

## 3. Yang bisa dicoba di dalam aplikasi

Dashboard punya tiga tab: **Dashboard log**, **Registry aset (on-chain)**, **Data user (off-chain)**.

### 3.1 Registry aset — CRUD on-chain (requirement 5)

1. `Login dengan Wallet` memakai akun ADMIN atau SOC_ANALYST.
2. Buka tab **Registry aset (on-chain)**.
3. Isi empat kolom: `assetId`, `nama aset`, `kategori`, `lokasi`.
4. Klik **Tambah aset** → konfirmasi di MetaMask → baris muncul + event `AssetCreated` di EVENT STREAM.
5. Ubah lewat tombol di baris tabel; **hapus hanya ADMIN** (tombol SOC_ANALYST/AUDITOR mati).

Biaya gas terukur (bukan perkiraan):

| Operasi | Chain lokal (Hardhat) | Sepolia (testnet) |
|---|---|---|
| `createAsset` | 233.422 gas | 1.022.303 gas |
| `updateAsset` | 52.085 gas | 69.350 gas |
| `deleteAsset` | 59.959 gas | 108.913 gas |

### 3.2 Data user — CRUD off-chain (requirement 6)

1. Buka tab **Data user (off-chain)**.
2. Isi `wallet address`, `nama lengkap`, `email`, `departemen`, `tim`, `catatan` → **Tambah user**.
3. MetaMask hanya meminta **tanda tangan** (`personal_sign`, tanpa gas). REST API memverifikasi
   tanda tangan itu lalu mencocokkan role on-chain sebelum menerima perubahan.
4. Ubah/hapus lewat tombol di tabel; perubahan langsung terlihat di MongoDB.

API-nya bisa diuji langsung dari command line (hasil nyata: **16/16** pemeriksaan lulus):

```bash
node integration/backend/api/smoke-test.js
```

### 3.3 Registry log — immutable by design

Log tidak diinput manual dari dashboard, dan itu memang disengaja: nilai keamanan proyek ini
bertumpu pada ketidakmampuan siapa pun mengubah hash log yang sudah dikunci. **Collector** yang
merekam log otomatis (lihat Bab 4); dashboard hanya menampilkan log terdaftar beserta statusnya.

---

## 4. Demo alarm anti-tamper (uji end-to-end)

Memperagakan serangan sungguhan: penyerang masuk, jejaknya tercatat, lalu penyerang menghapus
baris log — dan sistem mendeteksinya.

1. Jalankan stack mode chain lokal (Bab 2.2), biarkan dashboard terbuka.
2. Buat percobaan login gagal (brute force) ke server korban:

   ```bash
   docker exec siem-victim sh -c 'for i in $(seq 1 25); do logger -p auth.info \
     "Failed password for invalid user attacker from 10.0.0.$i port 5$i ssh2"; done'
   ```

3. Tunggu ± 15 detik → batch log (25 baris) direkam ke blockchain dalam satu transaksi
   (**terukur 253.904 gas**) dan muncul di tabel log.
4. Simulasikan penyerang menghapus jejaknya:

   ```bash
   f=$(ls infra/siem-batches/auth-*.log | head -1); sed -i '1d' "$f"
   ```

5. Tunggu ± 25–40 detik → banner merah **TAMPERING DETECTED** muncul lengkap dengan
   perbandingan hash asli (on-chain) vs hash server saat ini; baris log menjadi `TAMPERED` dan
   event `TamperingDetected` (**terukur 52.452 gas**) tercatat di EVENT STREAM.

Inti penjelasan: hash server tidak lagi sama dengan hash yang dikunci di blockchain → kontrak
memancarkan event → dashboard yang mendengarkan event itu langsung memberi alarm tanpa pemeriksa
manual. Karena log immutable, penyerang tidak punya cara menimpa hash aslinya.

### 4.1 Mengulang demo dari keadaan kosong

```bash
docker compose --profile local down -v
find infra/siem-batches -type f ! -name '.gitkeep' -delete
# lalu klik dua kali jalankan-stack-lokal.bat  ->  0 log, 0 aset, 0 user
```

---

## 5. Membuktikan sendiri (bukti uji otomatis)

| Perintah | Hasil yang diharapkan |
|---|---|
| `NODE_ENV=development npx hardhat test` | **22 test lulus** (RBAC, registry log, CRUD aset, gas) |
| `NODE_ENV=development npm run test:backend` | **59 test lulus** (28 collector + 12 batch-queue + 19 API) |
| `node integration/backend/api/smoke-test.js` | **16/16** pemeriksaan end-to-end lulus (butuh stack & MongoDB hidup) |

Di GitHub, tab **Actions** menunjukkan tiga workflow CI yang berjalan di setiap perubahan:
pengujian kontrak + backend, build dashboard, dan validasi konfigurasi stack.

### 5.1 Memeriksa kontrak langsung dari blockchain

Alamat Sepolia bisa dibaca tanpa aplikasi, misalnya lewat Remix (*At Address*) atau RPC publik
`https://ethereum-sepolia-rpc.publicnode.com`.

| Fungsi | Kegunaan |
|---|---|
| `VERSION()` | Versi kontrak (`4.0.0`) |
| `getRoleName(address)` | Role sebuah alamat (`ADMIN`/`SOC_ANALYST`/`AUDITOR`/`NONE`) |
| `getLogCount()` | Jumlah hash log yang terdaftar on-chain |
| `getAssetCount()` / `getAssetIds()` | Jumlah dan daftar id aset |
| `getAsset(string)` | Detail satu aset (nama, kategori, lokasi, waktu buat/ubah, pembuat) |

Indeks `getAssetIdAt(n)` dimulai dari **0**; indeks di luar jumlah aset akan revert — perilaku
kontrak yang benar, bukan kerusakan.

---

## 6. Kalau ada yang tidak jalan

| Gejala | Penyebab & solusi |
|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop belum selesai nyala — tunggu 1–2 menit, klik file `.bat` lagi |
| `Container name siem-xxx is already in use` / port terpakai | Stack sudah jalan — langsung buka `http://127.0.0.1:8088` |
| Halaman browser kosong / error | Dashboard masih memuat kontrak — tunggu ± 30 detik lalu refresh |
| Semua container berhenti | Kemungkinan `matikan-stack.bat` pernah diklik — nyalakan lagi lewat file `.bat` di Bab 2.2 |
| Kontrak tidak ditemukan setelah laptop menyala ulang | Chain lokal kembali ke blok 0 dan kontraknya hilang — jalankan `docker compose --profile local up -d` sekali lagi (service `deploy` men-deploy ulang otomatis) |
| Tab Registry aset `0 aset` padahal chain berisi aset | Mode "masuk tanpa wallet" bersifat hanya-baca — pakai "masuk sebagai alamat ini" atau login dengan wallet |
| Tabel aset/data user kosong pada mode Sepolia | Normal: collector menulis ke chain lokal, bukan Sepolia — pakai `jalankan-stack-lokal.bat` untuk melihat data yang mengalir |
| Tombol Tambah aset / Tambah user mati | Akunmu AUDITOR atau sedang di mode hanya-baca — login dengan akun ADMIN/SOC_ANALYST |

---

## 7. Struktur repository

| Folder / berkas | Isi |
|---|---|
| `contracts/SIEMLogger.sol` | Smart contract: 3 role, registry log (immutable), registry aset (CRUD), 9 event, 15 custom error. Solidity 0.8.26, optimizer runs 200, EVM paris |
| `test/` | 22 test Hardhat, termasuk pengujian penolakan RBAC |
| `integration/backend/` | Collector & hashing (SHA-256 berkas dan Merkle root per baris) + REST API Express |
| `integration/frontend/` | Dashboard SOC (React + Vite): login, tabel log, registry aset, data user, event stream |
| `infra/victim-server/` | Server korban simulasi (SSH + rsyslog) dan shipper log |
| `deployments.json` | Sumber tunggal alamat kontrak: alamat, tx hash deploy, alamat tiap role, bukti tx CRUD aset di Sepolia |
| `README.md` | Peta requirement brief → implementasi + panduan teknis |
| `STATUS.md` | Checkpoint status proyek: apa yang sudah jadi, bukti uji, sisa pekerjaan |

Catatan keterbatasan yang kami nyatakan terbuka: kontrak di Sepolia belum diverifikasi di
Etherscan (alamat, tx hash, dan ABI tersedia di repo), dan AUDITOR pada kontrak testnet saat ini
memakai akun uji tim.
