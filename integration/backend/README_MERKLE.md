# 🌳 Merkle Log Collector (Jobdesk #2)

Dokumen ini menjelaskan implementasi dari **Cryptographic & Backend Engineer (Jobdesk #2)**, yang menggunakan algoritma Merkle Tree untuk verifikasi integritas log, beserta penyimpanan log off-chain dengan **MongoDB**.

## 💡 Konsep

Pendekatan `merkleCollector.js` memodifikasi skema hashing menjadi lebih detail:
1. File log dipecah **baris demi baris**.
2. Setiap baris di-hash (`SHA-256`) untuk menjadi sebuah *Leaf Node*.
3. Dari node-node tersebut dibangun sebuah **Merkle Tree**.
4. Hanya hash tertinggi (**Merkle Root**) yang dikunci ke blockchain.
5. Log mentahnya (raw text) dan hash per barisnya disimpan ke MongoDB (database off-chain).

**Kelebihan:** 
- Kita bisa tahu **persis baris mana** yang dimodifikasi oleh hacker, tidak hanya sekadar mendeteksi adanya manipulasi pada file secara umum.
- Menghemat biaya (gas fee) karena kita tidak menyimpan seluruh log di blockchain.

## 🛠️ Prasyarat & Setup

1. **Pastikan MongoDB menyala**.
   Bisa pakai instalasi lokal, Docker, ataupun **MongoDB Atlas (Cloud)**.
2. Tambahkan variabel `MONGO_URI` di file `.env`. (Lihat `.env.example`).
   Contoh lokal: `MONGO_URI=mongodb://127.0.0.1:27017/siem_logs`
   Contoh Atlas: `MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/siem_logs`
3. Install package NPM:
   ```bash
   npm install
   # Dependensi baru: merkletreejs, mongoose, dotenv
   ```

## 🚀 Cara Menjalankan

Sama seperti script dasar sebelumnya, ada empat mode. Buka terminal di root project.

### 1. Mode Record (Menyimpan Log Baru)
```bash
node integration/backend/merkleCollector.js record integration/backend/sample/auth.log "auth.log#01"
```
Apa yang terjadi?
- Script membaca `auth.log` dan memecahnya menjadi kumpulan baris.
- Menyimpan setiap baris ke MongoDB ke dalam koleksi `logbatches`.
- Membangun Merkle Tree, dan mengirim **Merkle Root** ke smart contract (on-chain).
- Menulis **bukti Merkle per baris** ke `auth.log.auth.log-01.proofs.json`.

> ⚠️ Jalankan `record` selagi file log masih **asli** — bukti dibuat dari isi file
> saat itu. Kalau file sudah diubah penyerang lalu di-`record`, yang tersegel
> on-chain adalah versi palsunya (tidak ada baseline pembanding).

### 2. Mode Watch (Verifikasi Keamanan)
```bash
node integration/backend/merkleCollector.js watch integration/backend/sample/auth.log "auth.log#01"
```
Apa yang terjadi?
- Script membaca `auth.log` di server.
- Membangun ulang Merkle Tree dan membandingkan Merkle Root yang dihasilkan dengan Merkle Root yang ada di Smart Contract.
- Jika berbeda (Tampered):
  - Sistem akan mengirim alarm (event `TamperingDetected`) ke blockchain.
  - Script juga akan **membandingkan data file server dengan data asli di MongoDB** secara baris demi baris, dan menampilkan persis **baris mana yang telah diubah/dihapus/ditambah**.

---
### 3. Mode Prove (Merkle proof per baris — bukti kriptografis)
```bash
node integration/backend/merkleCollector.js prove integration/backend/sample/auth.log "auth.log#01"
node integration/backend/merkleCollector.js prove integration/backend/sample/auth.log "auth.log#01" 1
```
Apa yang terjadi?
- Membaca Merkle Root **on-chain** (`getLogStatus`, gratis) dan artefak bukti
  (MongoDB dulu, lalu `<fileLog>.<logId>.proofs.json`).
- Untuk setiap baris: hitung `sha256(isi baris sekarang)`, lalu verifikasi proof-nya
  sampai menghasilkan Merkle Root on-chain.
- Hasil per baris: `✅ TERBUKTI identik` atau `🔴 TIDAK TERBUKTI` (ditambah tampilan
  isi asli vs sekarang). Exit code `1` kalau ada baris yang gagal.
- **Hanya-baca**: tidak butuh `PRIVATE_KEY`, tidak butuh MongoDB, tidak menulis apa
  pun on-chain — auditor pun bisa menjalankannya.
- Argumen opsional `[indexBaris]` untuk memeriksa satu baris saja. Bukti satu baris
  jauh lebih pendek dari file: cukup sibling hash di jalur daun → root.

### 4. Mode Batch (banyak logId dalam satu transaksi)
```bash
# manifest.txt — satu entri per baris: <logId> <path file log>
#   auth.log#01 /var/log/auth.log
#   syslog#01   /var/log/syslog
node integration/backend/merkleCollector.js batch manifest.txt
```
Apa yang terjadi?
- Tiap entri dihitung Merkle Root-nya, lalu **satu transaksi**
  `recordLogHashBatch(ids, hashes)` mengunci semuanya (hemat ±17% gas per log:
  173.122 vs 208.756 gas/log di node lokal).
- `logId` yang sudah terdaftar on-chain otomatis dilewati (dicek lewat `view`,
  gratis) karena kontrak bersifat *all-or-nothing*; file yang hilang/kosong juga
  dilewati dengan alasannya tercetak.
- Bukti per baris ikut ditulis untuk setiap entri.

---

*Dikembangkan oleh Tim Jobdesk #2 (Cryptographic & Backend Engineer).*

---

## ⚠️ Syarat & batasan yang perlu diketahui

**1. MongoDB OPSIONAL.** Isi `MONGO_URI` di `integration/backend/.env` kalau
mau menyimpan baris log off-chain; biarkan kosong (default di `.env.example`)
atau pakai flag `--no-db` untuk jalan tanpa Mongo. Yang hilang tanpa Mongo
hanya perbandingan baris demi baris. Kalau `MONGO_URI` diisi tapi Mongo tidak
menyala, skrip tetap berhenti dengan `ECONNREFUSED 127.0.0.1:27017` — sengaja,
supaya tidak menulis on-chain sambil mengira salinan off-chain tersimpan.

**2. Konfigurasi dibaca dari `integration/backend/.env`** (path relatif ke
lokasi skrip), jadi boleh dijalankan dari root repo:

```bash
cp integration/backend/.env.example integration/backend/.env
# isi RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY, MONGO_URI
node integration/backend/merkleCollector.js record integration/backend/sample/auth.log "auth.log#01"
```

**3. Jangan memakai `merkleCollector.js` dan `logCollector.js` untuk `logId`
yang sama.** Nilai yang dikirim berbeda untuk file yang identik (Merkle Root vs
SHA-256 file utuh), sehingga pengecekan silang menghasilkan `false`. Sekarang
hal itu **terdeteksi otomatis**: sebelum mengirim alarm, skrip membandingkan
`logHash` on-chain dengan hasil hitung mode lain untuk file yang sama, lalu
mencetak `⚠️ SALAH SKRIP` dan **tidak mengirim transaksi alarm** — supaya
`isTampered` tidak tercemar alarm palsu (flag itu satu arah, tidak bisa
dikembalikan ke `false`). Diuji: file tidak berubah → `isTampered` tetap
`false` setelah pengecekan silang.

**4. `watch` sekarang sama dengan `logCollector.js`**: menerima
`[intervalDetik] [maxIterasi]` (default 5 detik, `0` = jalan terus), jadi bisa
dijalankan sebagai daemon (systemd / Docker). Uji cepat 2 iterasi:
`node merkleCollector.js watch <file> <logId> 2 2`.

**5. File tanpa baris berisi ditangani eksplisit.** Dulu pohon kosong
menghasilkan root `"0x"` (dan karena `"0x"` truthy, fallback `|| "0x000…0"`
tidak pernah jalan) sehingga semua log kosong bisa ber-hash sama. Sekarang:
`record` menolak dengan pesan jelas, `watch` menganggapnya tampering dan
mengirim penanda `0x__LOG_FILE_EMPTY__` sebagai bukti; selain itu panjang root
hasil Merkle diverifikasi dulu (harus 66 karakter) sebelum dikirim.

**6. Baris log mentah disimpan plaintext di MongoDB.** Untuk klaim
*tamper-proof*, perlu dicatat bahwa DB off-chain ini juga bisa ditulis ulang
oleh penyerang; yang membuat alarm tetap valid adalah Merkle Root **on-chain**.
Sejak mode `prove` ada, klaim "baris ke-i tidak berubah" **sudah** berupa bukti
kriptografis (Merkle proof → root on-chain), bukan lagi sekadar perbandingan
teks dengan salinan MongoDB. Perbandingan teks (dan MongoDB) sekarang hanya
berguna untuk menampilkan sisi manusianya: isi asli vs isi sekarang.

**7. File bukti `<fileLog>.<logId>.proofs.json` TIDAK perlu dipercaya.** Isinya
proof + isi baris; penyerang yang bisa menulis file ini tetap tidak bisa membuat
baris palsu lolos verifikasi, karena `prove` selalu mengecek proof itu terhadap
Merkle Root **on-chain**. Kalau file bukti diubah, hasilnya justru
`🔴 TIDAK TERBUKTI` (fail-closed). Nama file memuat `logId` supaya pola rotasi
(`auth.log#2026-10-09` vs `#2026-10-10`) tidak saling menimpa.

**8. `prove` butuh artefak bukti, `watch` tidak.** Kalau bukti belum pernah
dibuat (mis. `record` dijalankan sebelum fitur ini ada), `prove` berhenti dengan
pesan jelas dan menyarankan `record` ulang memakai `logId` baru.
