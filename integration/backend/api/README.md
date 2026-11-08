# API Off-Chain (data user) — Express + MongoDB

Bagian **Off-chain State Management** pada brief tugas: data yang **tidak** disimpan di
blockchain, dengan CRUD penuh (insert, view, update, delete).

| | Disimpan di | Contoh data | Kenapa |
|---|---|---|---|
| **On-chain** | smart contract `SIEMLogger` | hash log (immutable), registry aset, role akun | harus bisa dibuktikan & tidak bisa diubah diam-diam |
| **Off-chain** | MongoDB (`siem_offchain.users`) | nama, email, departemen, tim, status aktif user | data pribadi/operasional: mahal kalau di-chain, dan tidak perlu publik |

Otorisasi tetap satu sumber: **role dibaca dari kontrak** (`getRoleName`), bukan dari
database. Jadi mengubah data di MongoDB tidak bisa menaikkan hak akses seseorang.

---

## Autentikasi (login pakai wallet address)

Setiap request ke `/api/users` harus membawa tiga header — bukti bahwa pemanggil
memegang private key alamat wallet yang diklaim:

| Header | Isi |
|---|---|
| `x-wallet` | alamat Ethereum (`0x…`) |
| `x-message` | **base64** dari pesan kanonik di bawah (header HTTP tidak boleh berisi baris baru) |
| `x-signature` | hasil `personal_sign` (`signMessage`) atas pesan itu |

Pesan kanonik (persis, urutan ini):

```
SIEM Off-Chain API
wallet: 0x<alamat lowercase>
timestamp: <unix detik>
nonce: <acak>
```

Server menolak bila: format pesan salah, alamat di header ≠ alamat di pesan, tanda
tangan ≠ pemilik alamat, umur tanda tangan > 5 menit, **nonce sudah dipakai**
(anti-replay), atau role on-chain tidak cukup.

> Contoh implementasi klien ada di `integration/frontend/src/lib/wallet.js`
> (dipakai dashboard) dan `integration/backend/api/smoke-test.js` (uji dari terminal).

---

## Endpoint

| Method | Path | Aksi | Role minimum |
|---|---|---|---|
| GET | `/api/health` | status API + MongoDB + kontrak (tanpa auth) | — |
| GET | `/api/users?q=&team=&active=` | VIEW daftar user | `AUDITOR` |
| GET | `/api/users/:wallet` | VIEW satu user | `AUDITOR` |
| POST | `/api/users` | INSERT user | `SOC_ANALYST` |
| PUT | `/api/users/:wallet` | UPDATE user | `SOC_ANALYST` |
| DELETE | `/api/users/:wallet` | DELETE user | `ADMIN` |

Field user: `walletAddress` (kunci, unik), `name`, `email`, `department`, `team`,
`active`, `notes`, plus jejak `createdBy`/`updatedBy` (alamat wallet pelaku) dan
`createdAt`/`updatedAt` otomatis.

Kode status penting: `401` belum/ salah login · `403` role kurang (detailnya menyebut
role kamu & role yang dibutuhkan) · `409` nonce dipakai ulang atau data duplikat ·
`503` RPC/ kontrak tidak bisa dihubungi.

---

## Menjalankan

### Bagian dari stack (cara normal)

```bash
docker compose --profile local up -d --build
# API: http://127.0.0.1:8089   (MongoDB: service `mongo`, volume `siem-mongo`)
```

Alamat kontrak dibaca otomatis dari volume `/state` (hasil service `deploy`).

### Manual (tanpa Docker)

```bash
# butuh MongoDB lokal di 27017
export RPC_URL=http://127.0.0.1:8545
export CONTRACT_ADDRESS=0x<alamat hasil deploy>
export MONGO_URI=mongodb://127.0.0.1:27017/siem_offchain
npm run api
```

Env: `RPC_URL`, `CONTRACT_ADDRESS`, `MONGO_URI`, `PORT` (default 8089), `STATE_DIR`.

---

## Uji

```bash
npm run test:api                                   # 19 unit test (tanpa jaringan/DB)
node integration/backend/api/smoke-test.js         # end-to-end ke API yang sedang jalan
```

`smoke-test.js` membuktikan seluruh jalur: health → tanpa tanda tangan (401) →
role NONE (403) → INSERT (201) → duplikat (409) → VIEW (200) → UPDATE oleh
SOC_ANALYST (200) → UPDATE oleh AUDITOR (403) → DELETE oleh SOC_ANALYST (403) →
DELETE oleh ADMIN (200) → data hilang (404) → tanda tangan dipakai ulang (409).
Private key yang dipakai adalah akun dev bawaan Hardhat (publik, node lokal saja)
dan skrip ini menambahkan sendiri role `addAnalyst`/`addAuditor` sebelum menguji.
