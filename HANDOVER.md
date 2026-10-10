# 🤝 HANDOVER — dari #1 (Smart Contract) ke Tim

Dokumen serah terima. Ditulis oleh **Vincent (#1 — Smart Contract Developer / Web3 Lead)**.
Terakhir diperbarui: 2026-10-10 · commit `a384439`.

Tujuannya: supaya **Yasin (#2 backend)** dan **Joseph (#5 frontend)** langsung paham
apa yang sudah jadi, apa yang mereka terima, dan dari mana mereka mulai.

---

## 1. Kontrak sudah LIVE di Sepolia ✅

| Item | Nilai |
|---|---|
| Contract Address | `0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd` |
| Network | Sepolia (chainId `11155111`) |
| RPC yang dipakai | `https://ethereum-sepolia-rpc.publicnode.com` |
| Explorer | https://sepolia.etherscan.io/address/0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd |
| ABI | [`contracts/SIEMLogger.json`](contracts/SIEMLogger.json) |
| Versi kontrak | `3.0.0` |
| Sumber tunggal alamat | [`deployments.json`](deployments.json) |

Owner / **ADMIN** = akun deployer (`0x6bbd8f8c13df812fbdeb6e13145e82f7c74e9297`).
Selalu baca alamat terbaru dari `deployments.json`, jangan hardcode di banyak tempat.

---

## 2. Apa yang diterima tiap orang

### Yasin (#2 — Cryptographic & Backend Engineer)

Terima: Contract Address, chainId `11155111`, RPC URL, ABI, dan (menyusul) **role SOC_ANALYST**.
Titik mulai: [`integration/backend/`](integration/backend/) — `logCollector.js`, `.env.example`, `sample/auth.log`.

**Bisa mulai SEKARANG tanpa role.** Uji di node lokal (`npx hardhat node`) — di situ akunmu
otomatis admin, jadi `recordLogHash` / `verifyLogIntegrity` bisa langsung dicoba. Role
SOC_ANALYST baru diperlukan saat transaksi ke kontrak **Sepolia** milik Vincent.
Sebelum role di-set, panggilan tulis ke Sepolia akan gagal dengan error `NotOperator`.

### Joseph (#5 — Frontend SOC Dashboard)

Terima: Contract Address, chainId, ABI, nama event `TamperingDetected`.
Titik mulai: [`integration/frontend/index.html`](integration/frontend/index.html).

**Tidak butuh role.** Dashboard hanya *membaca* (`getLogStatus`, `getLogEntry`,
`verifyLogIntegrityView`) dan *mendengarkan* event `TamperingDetected` — semuanya publik
dan gratis (0 gas). Tidak ada fungsi tulis yang dipanggil dari frontend.

---

## 3. Status role (on-chain)

| Akun | Alamat publik | Role | Status |
|---|---|---|---|
| Vincent (#1, owner/deployer) | `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` | ADMIN | ✅ otomatis saat deploy |
| Yasin (#2, backend) | `0x78ab74A8d8AA1490ECB3F806fE1e25f40DcF88a0` | SOC_ANALYST | ✅ terpasang (blok 11885571) |
| Nat (#6, auditor) | — | AUDITOR | ⏳ menunggu alamat |

Yang masih pending:

- [ ] `addAuditor(<alamat Nat>)` → `AUDITOR`
- [ ] (opsional) Verifikasi kontrak di Etherscan agar bisa dibaca/ditulis dari explorer

Cara minta role: kirim **alamat publik** ke Vincent — format `0x...` (42 karakter),
diambil dari bagian **Ethereum** di MetaMask (bukan Bitcoin/Solana/Tron/Stellar).

> ⚠️ Hanya alamat publik. **Jangan pernah** mengirim seed phrase atau private key ke siapa pun,
> termasuk ke Vincent.

Setelah di-set, cek sendiri dari Remix: `getRoleName(0x<alamatmu>)` harus mengembalikan
`"SOC_ANALYST"` / `"AUDITOR"` / `"ADMIN"` / `"NONE"`.

---

## 4. Fungsi & event yang akan kamu pakai (ringkas)

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `recordLogHash(logId, logHash)` | SOC_ANALYST, ADMIN | ~208k | Kunci hash log on-chain (sekali per `logId`) |
| `verifyLogIntegrity(logId, currentHash)` | SOC_ANALYST, ADMIN | ~46k | Bandingkan; kalau beda → `isTampered=true` + emit `TamperingDetected` |
| `verifyLogIntegrityView(logId, currentHash)` | siapa saja | **0** | Cek integritas gratis (untuk UI/polling) |
| `getLogStatus(logId)` | siapa saja | 0 | `(hash asli, timestamp, isTampered)` |
| `getLogEntry(logId)` | siapa saja | 0 | Semua field entri log |
| `recordLogHashBatch(ids, hashes)` | SOC_ANALYST, ADMIN | ~169k/log | Impor banyak log dalam 1 transaksi |

| Event | Kapan | Dipakai |
|---|---|---|
| `LogRecorded(logId, logHash, timestamp)` | hash dikunci | Yasin (konfirmasi) |
| `LogVerified(logId, currentHash, isMatch, timestamp)` | tiap verifikasi | Joseph (log aktivitas) |
| **`TamperingDetected(logId, expectedHash, actualHash)`** | **hash server ≠ on-chain** | **Joseph → 🔴 ALARM** |

> `logId` pada event **tidak di-index** (sengaja), supaya isinya bisa dibaca langsung dari
> payload event. Kalau di-index, dashboard tidak akan tahu log mana yang bermasalah.

---

## 5. Uji seluruh alur dulu secara lokal (tanpa testnet, tanpa MetaMask)

```bash
# terminal 1
npm install && npx hardhat node

# terminal 2
npx hardhat run scripts/deploy.js --network localhost
export RPC_URL=http://127.0.0.1:8545
export CONTRACT_ADDRESS=<alamat hasil deploy>
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
node integration/backend/logCollector.js record integration/backend/sample/auth.log "auth.log#2026-10-10"
node integration/backend/logCollector.js watch  integration/backend/sample/auth.log "auth.log#2026-10-10" 5 1
```

Detail lengkap: [`integration/README.md`](integration/README.md).

---

## 6. Cara berkontribusi (alur Git & branch)

`main` **dilindungi** — tidak ada yang boleh push langsung ke sana. Semua perubahan lewat
**branch + Pull Request**. Ini supaya kesalahan di branch tidak merusak `main`.

```bash
git clone https://github.com/Yenmau/tamper-proof-siem-dapp.git
cd tamper-proof-siem-dapp
git checkout -b feat/<nama-pekerjaan>
# ...kerja & commit...
git push -u origin feat/<nama-pekerjaan>
```

Lalu buka **Pull Request** ke `main` di GitHub — minta Vincent review & merge.

Aturan main:

- Satu branch = satu pekerjaan (jangan campur backend + frontend dalam satu branch).
- Jangan push langsung ke `main` (diblokir otomatis oleh ruleset).
- Vincent (#1) yang merge ke `main`.
- Lakukan `git pull origin main` dulu sebelum mulai, biar branch-nya tidak basi.

Branch yang disarankan:

| Orang | Branch | Isi |
|---|---|---|
| Yasin (#2, backend) | `feat/backend-logcollector` | `integration/backend/` |
| Joseph (#5, frontend) | `feat/frontend-dashboard` | `integration/frontend/` |

## 7. Yang JANGAN dilakukan

- ❌ Mengubah signature 3 fungsi inti (`recordLogHash`, `verifyLogIntegrity`, `getLogStatus`) —
  dokumen backend & frontend sudah mengacu ke situ.
- ❌ Commit file `.env` (sudah ditutup `.gitignore`).
- ❌ Deploy kontrak baru lalu lupa memperbarui `deployments.json`.
- ❌ Meminta/mengirim private key atau seed phrase.

---

*Pertanyaan soal kontrak / ABI / event → tanya Vincent (#1).*
*Backend Merkle/DB → Yasin. Dashboard/React → Joseph.*
