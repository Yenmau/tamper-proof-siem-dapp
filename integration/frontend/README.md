# SOC Dashboard (React + Vite) — jobdesk #5

Dashboard SOC untuk Tamper-Proof SIEM. Menggantikan versi satu-file
(`legacy-dashboard.html`, masih ada sebagai referensi).

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
start dari env `RPC_URL`, `CONTRACT_ADDRESS`, `CHAIN_ID`, `NETWORK_NAME`). Kalau
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
