# PROGRESS — Point 1 (Smart Contract Developer / Web3 Lead)

Catatan pribadi Vincent. Scope: **hanya** point 1. Ini bukan dokumen tim.

Terakhir diperbarui: 2026-10-09 · commit `9a3b706`

---

## 1. Scope tugas (sesuai brief)

**Fokus:** Logika On-Chain & Keamanan Smart Contract

| # | Tugas | Status |
|---|---|---|
| 1 | Menulis & menguji kode Solidity (`SIEMLogger.sol`) | ✅ selesai |
| 2 | Membuat fungsi pencatatan hash & verifikasi integritas | ✅ selesai |
| 3 | Mengatur akses otorisasi 3 role (Admin, SOC Analyst, Auditor) | ✅ selesai |
| 4 | **Deployment ke jaringan testnet** | ❌ **BELUM** |

**Deliverable yang harus diserahkan:**

| Deliverable | Status | Lokasi |
|---|---|---|
| `contracts/SIEMLogger.sol` | ✅ | [contracts/SIEMLogger.sol](contracts/SIEMLogger.sol) |
| `contracts/SIEMLogger.json` (ABI) | ✅ 44 entri | [contracts/SIEMLogger.json](contracts/SIEMLogger.json) |
| Contract Address hasil testnet | ❌ kosong | [deployments.json](deployments.json) |

Itu saja. 3 dari 4 tugas beres, sisa 1.

---

## 2. ⏭️ LANJUT DARI SINI (yang harus dikerjakan)

### Langkah A — Deploy ke testnet (BLOCKER utama)

Butuh MetaMask punya sendiri. Panduan lengkap 1-per-1 + link faucet yang masih aktif
ada di **[DEPLOY.md](DEPLOY.md)**. Ringkasnya:

1. Tambah network **Sepolia** ke MetaMask (chainId `11155111`, RPC `https://rpc.sepolia.org`)
   — atau **Polygon Amoy** (`80002`, `https://rpc-amoy.polygon.technology/`, gas token POL).
2. Ambil token gratis dari faucet:
   - Sepolia: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
   - Amoy: https://faucet.polygon.technology/
3. Buka https://remix.ethereum.org → buat file `contracts/SIEMLogger.sol` → paste isi
   file dari repo ini.
4. Tab **Solidity Compiler**:
   - Compiler **0.8.26**
   - **Enable optimization** ✅, runs **200**
   - EVM Version **paris**
   - ⚠️ Wajib sama dengan `hardhat.config.js`, kalau tidak bytecode/ABI-nya bisa beda.
5. Tab **Deploy & Run** → Environment **`Injected Provider - MetaMask`** →
   Contract **`SIEMLogger`** → **Deploy** → Confirm di MetaMask.
6. **Catat Contract Address**-nya (muncul di daftar *Deployed Contracts* atau di
   terminal Remix, dan tercatat di Activity MetaMask).

### Langkah B — Catat hasilnya

Isi [`deployments.json`](deployments.json):

```json
"11155111": {
  "network": "sepolia",
  "contract": "SIEMLogger",
  "address": "0x....",          <-- isi ini
  "deployTxHash": "0x....",
  "deployedAt": "2026-10-..",
  "explorer": "https://sepolia.etherscan.io/address/"
}
```

Lalu `git add deployments.json && git commit -m "chore: contract address testnet" && git push`.

### Langkah C — Set role akun tim (ini on-chain, tetap scope kamu)

Dari Remix, pakai fungsi di **Deployed Contracts** (kirim dari akun deployer):

| Fungsi | Isi | Untuk siapa |
|---|---|---|
| `addAnalyst(address)` | alamat akun Yasin | #2 — biar boleh tulis & verifikasi log |
| `addAuditor(address)` | alamat akun auditor | #6 — read-only |
| `addAdmin(address)` | alamat (opsional) | admin penuh |

Cek pakai `getRoleName(address)` → harus balikin `"ADMIN"` / `"SOC_ANALYST"` / `"AUDITOR"` / `"NONE"`.

### Langkah D — Serahkan ke tim

- **Ke Yasin (#2):** Contract Address, network + chainId, RPC URL, file `contracts/SIEMLogger.json` (ABI), plus info bahwa akunnya sudah di-`addAnalyst`.
- **Ke Joseph (#5):** Contract Address, chainId, ABI, nama event `TamperingDetected`.

Setelah A–D selesai → **point 1 kamu 100%.**

### ⏸️ Keputusan yang masih menggantung

Dua file ini **di luar scope** kamu (kerjaan orang lain). Mau dihapus atau dibiarkan
sebagai referensi — belum diputuskan:

- `integration/backend/logCollector.js` → kerjaan #2 Yasin
- `integration/frontend/index.html` → kerjaan #5 Joseph

---

## 3. Ringkasan teknis kontrak (biar tidak perlu baca ulang kodenya)

| Item | Nilai |
|---|---|
| Versi | `3.0.0` (`VERSION()`) |
| Compiler | Solidity 0.8.26, optimizer runs 200, EVM `paris` |
| Bytecode | 8.948 byte |
| ABI | 44 entri |
| Test | **15 test Hardhat, semua lolos** (`npm install && npm test`) |

### 3 fungsi inti (dari brief — signature tidak pernah berubah sejak v1.0)

| Fungsi | Akses | Gas | Kegunaan |
|---|---|---|---|
| `recordLogHash(logId, logHash)` | ANALYST, ADMIN | ~208.700 | Kunci hash log ke blockchain (sekali saja per logId) |
| `verifyLogIntegrity(logId, currentHash)` | ANALYST, ADMIN | ~45.700 | Bandingkan; kalau beda → set `isTampered` + emit alarm |
| `getLogStatus(logId)` | siapa saja (view) | 0 | `(hash asli, timestamp, isTampered)` |

### RBAC 3 role

```
Role          Nilai   Tulis log   Verify+alarm   Verify view (gratis)   Kelola role
ADMIN           3        ✅            ✅               ✅                  ✅
SOC_ANALYST     2        ✅            ✅               ✅                  ❌
AUDITOR         1        ❌            ❌               ✅                  ❌
NONE/publik     0        ❌            ❌               ✅                  ❌
```

Manajemen role: `setRole`, `addAdmin`, `addAnalyst`, `addAuditor`, `removeRole` (butuh ADMIN).
Owner otomatis ADMIN dan **tidak bisa dicabut**.

### Tambahan v2.0/v3.0

`verifyLogIntegrityView` (verifikasi GRATIS, 0 gas) · `recordLogHashBatch` (hemat ~19% gas/log) ·
`getLogEntry` / `getLogCount` / `getLogIds` / `getLogIdAt` · event `LogRecorded`,
`LogVerified`, **`TamperingDetected`** (ini yang memicu alarm), `RoleAssigned`, `RoleRevoked`.

### 3 temuan/bug yang ketemu & sudah ditutup (bahan laporan)

1. **v1.0 → v2.0:** `verifyLogIntegrity` bisa dipanggil siapa saja → orang luar bisa memicu
   alarm palsu (griefing) karena `isTampered` bersifat satu arah. → sekarang `onlyOperator`.
2. **v3.0:** `string indexed logId` di event → isinya tidak bisa dibaca kembali, dashboard tidak
   tahu log mana yang di-tamper. → sekarang non-indexed.
3. **Kit integrasi:** file log yang dihapus bikin skrip error, bukan alarm. → sekarang terdeteksi.

Semua ada alasannya di [CHANGELOG.md](CHANGELOG.md).

---

## 4. Riwayat commit (urutan kerjaan)

| Commit | Isi |
|---|---|
| `8b9e1f6` | v2.0 — verifikasi gratis, batch, optimasi gas, custom error, ABI, DEPLOY.md |
| `adedbf6` | v3.0 — RBAC 3 role (Admin / SOC Analyst / Auditor) |
| `e6a0fdb` | sinkron versi package-lock |
| `8c0539f` | kit integrasi + fix event logId tidak terbaca |
| `9a3b706` | fix: hapus file log harus memicu alarm |

Repo: https://github.com/Yenmau/tamper-proof-siem-dapp

---

## 5. Jangan lakukan ini

- ❌ Mengerjakan backend Merkle Tree / DB → itu #2 Yasin
- ❌ Mengerjakan dashboard/React → itu #5 Joseph
- ❌ Docker/systemd/rsyslog → itu #3 DevOps
- ❌ Threat model / CVSS / laporan checkpoint → itu #6 Auditor & QA
- ❌ Commit file `.env` (sudah ditutup `.gitignore`)
- ❌ Mengubah signature 3 fungsi inti — dokumen Yasin & Joseph sudah mengacu ke situ
