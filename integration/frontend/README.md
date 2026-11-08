# SOC Dashboard (React + Vite) — jobdesk #5

Dashboard SOC untuk Tamper-Proof SIEM. Menggantikan versi satu-file
(`legacy-dashboard.html`, masih ada sebagai referensi).

## Login (authentication pakai wallet address)

Aplikasi dibuka dengan halaman **Login**: tombol *Login dengan Wallet* memanggil
MetaMask (`eth_requestAccounts`), lalu role dibaca dari kontrak
(`getRoleName(alamat)`). Alamat tanpa role (`NONE`) ditolak. Ada juga pilihan
*masuk tanpa wallet (hanya-baca)* untuk melihat tabel & alarm tanpa menulis apa pun.

Setelah login, dashboard punya tiga tab:

| Tab | Isi | Butuh role |
|---|---|---|
| **Dashboard log** | registry log on-chain + alarm real-time + bukti Merkle per baris | siapa saja (baca) |
| **Registry aset (on-chain)** | CRUD aset di kontrak: `createAsset` / `updateAsset` / `deleteAsset` | create+update: ADMIN & SOC_ANALYST · delete: ADMIN |
| **Data user (off-chain)** | CRUD data user di MongoDB lewat API (tanda tangan wallet per request) | baca: semua role · tulis: ADMIN & SOC_ANALYST · hapus: ADMIN |

Tombol yang tidak diizinkan role kamu otomatis mati, dan kontrak tetap menolak
walau tombolnya dipaksa (kontrol sebenarnya ada on-chain, bukan di UI).

## Yang bisa dilakukan

- **Registry log on-chain** — `getLogCount` + `getLogIdAt` + `getLogEntry`: logId,
  Merkle Root, waktu rekam, verifikasi terakhir, siapa yang merekam, status.
- **Alarm real-time** — mendengarkan event `TamperingDetected` (dan `LogRecorded` /
  `LogVerified` untuk event stream): banner merah + judul tab berkedip.
- **Detail per log** + **panel bukti Merkle per baris**: dashboard mengambil file
  batch + artefak `…proofs.json`, lalu **memverifikasi proof di browser**
  (WebCrypto SHA-256) terhadap Merkle Root **on-chain** — tidak mempercayai backend.
  Tersedia juga cek ulang gratis: hitung root file batch sekarang di browser, lalu
  tanya kontrak lewat `verifyLogIntegrityView` (0 gas).
- **Filter + export CSV** dari registry.
- **Jalan tanpa MetaMask** (mode hanya-baca lewat RPC). Tombol *connect wallet*
  opsional, hanya untuk menampilkan role akun.

## Menjalankan

### Cara cepat (bagian dari stack gabungan, dari root repo)

```bash
docker compose up -d dashboard
# dashboard: http://127.0.0.1:8088
```

### Mode pengembangan

```bash
cd integration/frontend
NODE_ENV=development npm install       # devDependencies (vite/tailwind) dibutuhkan
npm run dev                            # http://127.0.0.1:5173
```

Konfigurasi dibaca dari `public/config.json` (dibuat otomatis saat container
start dari env `RPC_URL`, `CONTRACT_ADDRESS`, `CHAIN_ID`, `NETWORK_NAME`).
`RPC_URL` di sini dipakai **browser**, jadi harus alamat yang bisa diakses dari
host (bukan nama service docker): pada profil lokal `docker-compose.yml` mengisi
`http://127.0.0.1:8545` lewat `BROWSER_RPC_URL`. `CONTRACT_ADDRESS` boleh kosong —
kalau volume `/state` ada, alamat hasil deploy dibaca dari situ. Kalau
alamat kontrak kosong, dashboard menampilkan input untuk menempel alamat
(disimpan di localStorage) — berguna saat uji lokal.

Folder `/data` dipakai untuk file batch + artefak bukti. Pada stack gabungan
nginx menyajikan volume batch server korban di path itu; saat `npm run dev`,
`vite.config.js` mem-proxy `/data` ke `http://127.0.0.1:8088` (bisa diarahkan ke
`python -m http.server` yang menyajikan folder batch).

## Struktur

```
integration/frontend/
├── src/
│   ├── App.jsx                 ← state, polling, listener event
│   ├── lib/config.js           ← config runtime
│   ├── lib/contract.js         ← ABI sepotong + provider hanya-baca
│   ├── lib/merkle.js           ← verifikasi Merkle proof di browser
│   └── components/             ← Header, StatCards, LogTable, LogDetail, ProofPanel, AlarmBanner, EventStream
├── public/config.json          ← default untuk dev
├── nginx.conf                  ← serve SPA + /data (read-only)
├── docker-entrypoint.d/        ← tulis config.json dari env saat start
└── legacy-dashboard.html       ← dashboard versi lama (satu file)
```
