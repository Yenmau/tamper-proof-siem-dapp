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

Sama seperti script dasar sebelumnya, ada dua mode. Buka terminal di root project.

### 1. Mode Record (Menyimpan Log Baru)
```bash
node integration/backend/merkleCollector.js record integration/backend/sample/auth.log "auth.log#01"
```
Apa yang terjadi?
- Script membaca `auth.log` dan memecahnya menjadi kumpulan baris.
- Menyimpan setiap baris ke MongoDB ke dalam koleksi `logbatches`.
- Membangun Merkle Tree, dan mengirim **Merkle Root** ke smart contract (on-chain).

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
*Dikembangkan oleh Tim Jobdesk #2 (Cryptographic & Backend Engineer).*

---

## ⚠️ Syarat & batasan yang perlu diketahui

**1. MongoDB wajib menyala.** `merkleCollector.js` membuka koneksi Mongo di
awal `record` **dan** `watch`. Tanpa Mongo, skrip berhenti dengan
`ECONNREFUSED 127.0.0.1:27017`. `logCollector.js` tidak butuh Mongo.

**2. Konfigurasi dibaca dari `integration/backend/.env`** (path relatif ke
lokasi skrip), jadi boleh dijalankan dari root repo:

```bash
cp integration/backend/.env.example integration/backend/.env
# isi RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY, MONGO_URI
node integration/backend/merkleCollector.js record integration/backend/sample/auth.log "auth.log#01"
```

**3. Jangan memakai `merkleCollector.js` dan `logCollector.js` untuk `logId`
yang sama.** Nilai yang dikirim berbeda untuk file yang identik (Merkle Root vs
SHA-256 file utuh), sehingga pengecekan silang melaporkan `TAMPERED` palsu.
Diuji: file sama → `verifyLogIntegrityView` = `false`.

**4. `watch` di skrip ini hanya memeriksa SEKALI** (tidak ada `intervalDetik` /
`maxIterasi` seperti `logCollector.js`) — belum bisa dipakai sebagai daemon
tanpa pembungkus `while`/systemd timer.

**5. File log yang seluruh barisnya kosong menghasilkan root `"0x"`**
(`merklejs` tidak melempar error untuk pohon kosong), dan fallback
`|| "0x000…0"` di skrip tidak pernah terpakai karena `"0x"` sudah truthy.
Artinya semua log kosong bisa punya hash on-chain yang sama.

**6. Baris log mentah disimpan plaintext di MongoDB.** Untuk klaim
*tamper-proof*, perlu dicatat bahwa DB off-chain ini juga bisa ditulis ulang
oleh penyerang; yang membuat alarm tetap valid adalah Merkle Root **on-chain**.
Selain itu **Merkle proof belum dibuat/diverifikasi**, jadi kemampuan
"menunjukkan baris mana yang diubah" saat ini berasal dari perbandingan teks
dengan salinan MongoDB (bukan bukti kriptografis).
