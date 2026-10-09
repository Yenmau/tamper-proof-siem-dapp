# 🚀 DEPLOY.md — Panduan Deploy ke Testnet

Dokumen ini dipakai Vincent (Smart Contract / Web3 Lead) untuk men-deploy
`SIEMLogger` ke testnet, lalu menyerahkan hasilnya ke **Yasin** (backend) dan
**Joseph** (frontend).

> Ringkasnya: **Remix IDE → MetaMask → network testnet → Deploy → catat Contract
> Address → bagikan.**

---

## 0. Yang harus disiapkan dulu

| Kebutuhan | Keterangan |
|---|---|
| MetaMask | extension browser, sudah dibuat |
| Saldo testnet | didapat dari faucet (gratis) — lihat langkah 2 |
| Remix IDE | https://remix.ethereum.org (tanpa install apa pun) |
| File kontrak | `contracts/SIEMLogger.sol` dari repo ini |

---

## 1. Tambahkan network testnet ke MetaMask

Buka **MetaMask → pilih network di atas → Add network → Add a network manually**.

### Pilihan A — Ethereum Sepolia (disarankan: paling banyak tooling)

| Field | Nilai |
|---|---|
| Network name | `Sepolia` |
| RPC URL | `https://rpc.sepolia.org` |
| Chain ID | `11155111` |
| Currency symbol | `ETH` |
| Block explorer | `https://sepolia.etherscan.io` |

> Biasanya Sepolia sudah bawaan MetaMask — aktifkan lewat
> **Settings → Advanced → Show test networks**.

### Pilihan B — Polygon Amoy

| Field | Nilai |
|---|---|
| Network name | `Polygon Amoy Testnet` |
| RPC URL | `https://rpc-amoy.polygon.technology/` |
| Chain ID | `80002` |
| Currency symbol | `POL` |
| Block explorer | `https://amoy.polygonscan.com` |

> ⚠️ Gas token Amoy sekarang **POL**, bukan MATIC. Jangan pilih network
> "Mumbai" — sudah dimatikan sejak April 2024.

---

## 2. Ambil token testnet dari faucet (gratis)

Pilih salah satu (kalau gagal, coba berikutnya — faucet sering kena rate-limit):

**Sepolia**
| Faucet | Link | Catatan |
|---|---|---|
| Google Cloud Web3 | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | paling stabil, perlu login Google, ±0.05 ETH / 24 jam |
| Chainlink | https://faucets.chain.link/sepolia | connect wallet, ±0.1 ETH |
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | perlu akun Alchemy |
| PoW Faucet | https://sepolia-faucet.pk910.de | mining di browser, tanpa login |

**Polygon Amoy**
| Faucet | Link |
|---|---|
| Polygon (official) | https://faucet.polygon.technology/ |
| QuickNode | https://faucet.quicknode.com/polygon/amoy |
| Chainlink | https://faucets.chain.link/polygon-amoy |

Cara pakai: **copy alamat wallet MetaMask kamu** (yang `0x...`, dari tombol
*Receive*) → tempel di faucet → Request.

> 🔒 Aturan penting: faucet hanya butuh **alamat publik**. Jangan pernah
> memasukkan *seed phrase* atau *private key* ke situs mana pun, termasuk faucet.

Cek saldo sudah masuk di MetaMask (ikon mata di sebelah network).

---

## 3. Compile di Remix IDE

1. Buka https://remix.ethereum.org
2. Buat file baru di folder `contracts/` bernama **`SIEMLogger.sol`**,
   lalu copy-paste isi file `contracts/SIEMLogger.sol` dari repo ini.
3. Tab **Solidity Compiler** (ikon "S" di sidebar kiri), set:
   - **Compiler** : `0.8.26`
   - **Advanced Configurations → Enable optimization** : ✅ centang, **runs = 200**
   - **EVM Version** : `paris`
4. Klik **Compile SIEMLogger.sol**.
   Harus muncul tanda hijau ✅ dan **tidak ada error**.

> Setting optimizer/EVM ini HARUS sama dengan `hardhat.config.js` di repo,
> supaya ABI + bytecode yang dipakai tim identik.

---

## 4. Deploy

1. Tab **Deploy & Run Transactions** (ikon Ethereum).
2. **ENVIRONMENT** → pilih **`Injected Provider - MetaMask`**.
   → MetaMask akan terbuka; approve koneksinya.
   → Pastikan di bawahnya tertulis **Custom (11155111) network** (Sepolia)
   atau **Custom (80002)** (Amoy).
3. Di dropdown **CONTRACT**, pilih **`SIEMLogger - contracts/SIEMLogger.sol`**.
4. Constructor tidak punya parameter → langsung klik **Deploy**.
5. MetaMask muncul → klik **Confirm** (ini butuh sedikit gas testnet).
6. Setelah sukses, kontrak muncul di bagian **Deployed Contracts** (kiri bawah).

---

## 5. Catat Contract Address + copy ABI

**Contract Address** ada di dua tempat di Remix:

- di daftar **Deployed Contracts** (klik ikon copy di sebelah nama kontrak), atau
- di **terminal Remix** bagian bawah, baris:
  `[vm] from:0x... to:SIEMLogger.(constructor) value:0 wei data:0x... hash:0x...`
  → address-nya juga tercatat di riwayat MetaMask (Activity → transaksi
  *Contract Deployment* → copy alamat kontrak).

Formatnya seperti ini (contoh):

```
Contract Address : 0x5FbDB2315678afecb367f032d93F642f64180aa3
Deploy tx hash   : 0x9c1b...  (lihat di explorer)
Network          : Sepolia (chainId 11155111)
```

**ABI** untuk tim:

- **Sudah tersedia** (hasil compile terverifikasi) di
  [`contracts/SIEMLogger.json`](contracts/SIEMLogger.json) — file ini isinya
  persis array JSON yang dikeluarkan tombol "ABI" di Remix.
- Kalau mau ambil langsung dari Remix: tab **Solidity Compiler** → scroll ke
  bawah → klik tombol **ABI** (akan tercopy ke clipboard) → tempel ke
  `contracts/SIEMLogger.json`.
- Bytecode-nya juga tersedia di `contracts/SIEMLogger.bytecode.txt`.

---

## 6. (Opsional tapi bagus untuk nilai) Verifikasi kontrak di explorer

Supaya sumber kode bisa dibaca publik:

1. Buka `https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>`
   (atau `https://amoy.polygonscan.com/address/<CONTRACT_ADDRESS>`).
2. Tab **Contract** → **Verify and Publish**.
3. Isi: Compiler `0.8.26`, Optimization `Yes` runs `200`, EVM `paris`,
   Contract name `SIEMLogger`.
4. Paste isi file `.sol` → Verify.
5. Kalau berhasil, muncul tab **Read Contract** / **Write Contract** —
   ini cara paling gampang buat Yasin/Joseph ngetes tanpa Remix.

---

## 7. Serahkan ke tim — APA yang dikirim

Isi [`deployments.json`](deployments.json) di root repo (sumber tunggal alamat
kontrak), lalu bagikan 3 hal ini ke grup:

### 📤 Ke Yasin (Backend Log Collector)

```
1. Contract Address : 0x................................
2. Network          : Sepolia (chainId 11155111)
3. RPC URL          : https://rpc.sepolia.org   (atau endpoint Alchemy sendiri)
4. ABI              : contracts/SIEMLogger.json
5. Akun pengirim tx : alamat MetaMask yang sudah kamu jadikan admin
                      (butuh saldo testnet untuk gas)
```

Yang perlu Yasin lakukan di skripnya:
- `recordLogHash(logId, sha256(logFile))` saat log baru pertama kali dicatat.
- `verifyLogIntegrity(logId, sha256(logFile))` → kalau `return false`,
  artinya **log sudah diubah/dihapus** → kirim alert.
- Kalau Yasin mau akun server terpisah: minta Vincent
  `addAdmin(<alamat akun server>)` dulu.

### 📤 Ke Joseph (Frontend dApp)

```
1. Contract Address : 0x................................
2. Network + chainId: Sepolia / 11155111
3. ABI              : contracts/SIEMLogger.json
4. Alamat & ABI event TamperingDetected(...)
```

Yang perlu Joseph lakukan di UI:
- `getLogStatus(logId)` / `getLogEntry(logId)` untuk menampilkan status log.
- `verifyLogIntegrityView(logId, hashSaatIni)` → pengecekan **gratis** (view,
  tanpa gas) untuk menampilkan badge 🟢 AMAN / 🔴 TAMPERED.
- `contract.on("TamperingDetected", (logId, expected, actual) => { ... })`
  → **ini yang bikin alarmnya real-time**: begitu backend menandai tamper,
  semua browser yang membuka web langsung menerima event dan bisa memunculkan
  notifikasi/merah.

> Catatan: `TamperingDetected` tidak muncul sendiri. Backend-lah yang
> memicunya lewat transaksi `verifyLogIntegrity`. Artinya cron/loop di sisi
> Yasin tetap perlu jalan (mis. tiap 1 menit baca log → hash → verify).

---

## 8. Kalau ada masalah

| Gejala | Penyebab & solusi |
|---|---|
| `NotAdmin` waktu `recordLogHash` | akun MetaMask yang connect bukan admin. Tambah admin lewat `addAdmin` (dari akun deployer), atau pakai akun deployer. |
| `LogAlreadyExists` | logId itu sudah pernah didaftarkan. logId bersifat *immutable* — pakai logId baru (mis. `auth.log#2026-10-09`). |
| `LogNotFound` | logId belum pernah didaftarkan. Panggil `recordLogHash` dulu. |
| Deploy jalan terus tapi saldo 0 | faucet belum masuk, atau masih di network Mainnet. Cek network MetaMask. |
| Remix bilang `Contract not found` | file belum di-compile, atau nama kontrak di dropdown beda. Compile ulang. |
| `insufficient funds for gas` | saldo testnet habis, ambil faucet lagi. |
| MetaMask tidak muncul saat Deploy | Environment belum diubah ke `Injected Provider - MetaMask`. |

---

## 9. Setelah mainnet? (opsional, untuk cerita laporan)

Alur deploy-nya sama, hanya network-nya diganti ke Ethereum Mainnet / Polygon.
Kontrak yang sama bisa dipakai, tapi **gas jadi uang nyata** — di situ argumen
"gas optimization" di `CHANGELOG.md` jadi relevan untuk dijelaskan di laporan.
