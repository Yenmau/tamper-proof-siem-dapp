# ✅ Checklist Redeploy v4.0 ke Sepolia — klik-by-klik

Buat Vincent (mikro). Tujuan: kontrak live di Sepolia jadi **v4.0.0** supaya fitur
**registry aset (CRUD on-chain)** — poin 5 brief dApp — ada juga di testnet,
bukan cuma di chain lokal.

Anggaran waktu ±20 menit. Yang dibutuhkan: MetaMask + saldo Sepolia testnet.

---

## 0. Prasyarat

| Item | Nilai |
|---|---|
| Akun deployer | `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` (otomatis jadi `ADMIN`) |
| Saldo Sepolia | **0.027973 ETH** (dicek 11 Nov 2026 lewat 2 RPC publik — masih ada sisa dari deploy v3.0, jadi **tidak perlu faucet**). Deploy v4.0 = **2.917.610 gas**; gasPrice Sepolia saat ini **69 wei** → biaya ≈ **0.0002 ETH**. Faucet cuma perlu kalau MetaMask minta priority fee > 9 gwei (lihat tabel di bawah) |
| RPC Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` — **bukan** `https://rpc.sepolia.org` (yang itu pernah 404) |
| Explorer | `https://sepolia.etherscan.io` |
| Setting compile (wajib sama dengan repo) | Solidity **0.8.26** · optimizer ✅ **runs 200** · EVM **paris** · viaIR **OFF** |
| Constructor | tanpa parameter |

> ⚠️ Kontrak lama `0x1E6b3BFb571910e05080dDD16ecc2AC0f760BbBd` (v3.0) tidak bisa
> ditambal — bytecode tidak bisa di-upgrade. Karena itu harus deploy **kontrak baru**.

### Kalau ternyata tetap butuh saldo testnet (faucet)

| Faucet | Link | Cara |
|---|---|---|
| Google Cloud Web3 | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | login Google → pilih network **Ethereum Sepolia** → tempel **alamat publik** → Request. ±0.05 ETH / 24 jam |
| Chainlink | https://faucets.chain.link/sepolia | **Connect wallet** MetaMask → centang Sepolia → Send. ±0.1 ETH |
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | perlu akun Alchemy (gratis), pilih Sepolia |
| PoW Faucet | https://sepolia-faucet.pk910.de | tanpa login, "mining" di browser beberapa menit |

🔒 Faucet **hanya butuh alamat publik** (`0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297`).
Jangan pernah tempel seed phrase / private key ke situs mana pun.

Cek saldo kapan saja: `https://sepolia.etherscan.io/address/0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297`
(kalau MetaMask nunjukin 0 → hampir selalu karena network atau akun yang dipilih salah, bukan karena saldonya kosong).

---

## 1. Panaskan MetaMask

1. Buka MetaMask → aktifkan Sepolia (**Settings → Advanced → Show test networks**).
2. Kalau perlu, **Add network manually**: RPC `https://ethereum-sepolia-rpc.publicnode.com`, Chain ID `11155111`, symbol `ETH`.
3. Pastikan akun = `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` (network-nya harus Sepolia, bukan Hardhat lokal).
4. Cek saldo > 0.05 ETH. Kalau 0 → faucet Google Cloud (link di atas), hanya butuh **alamat publik**. Jangan pernah tempel seed phrase/private key ke situs mana pun.

## 2. Compile di Remix

1. Buka https://remix.ethereum.org
2. Sidebar **File Explorer** → folder `contracts` → **New File** → nama `SIEMLogger.sol`.
3. Buka `D:\Projects\tamper-proof-siem-dapp\contracts\SIEMLogger.sol` di VS Code → **Select All → Copy** → paste ke file Remix. (Baris pertama harus `// SPDX-License-Identifier: MIT`, baris ke-2 `pragma solidity ^0.8.20;`)
4. Tab **Solidity Compiler** (ikon "S"):
   - Compiler → pilih **0.8.26**
   - **Advanced Configurations** → ✅ **Enable optimization** → **runs = 200**
   - **EVM Version** → **paris**
5. Klik **Compile SIEMLogger.sol**.
   - ✅ Harus muncul centang hijau, **0 error**.
   - Cek di bagian bawah: **`VERSION`...? tidak ada** — cukup pastikan muncul tombol ABI. Kontrak versi ditandai `VERSION = "4.0.0"` di dalam kode (baris ~49).

## 3. Deploy

1. Tab **Deploy & Run Transactions** (ikon Ethereum).
2. **ENVIRONMENT** → **Injected Provider - MetaMask**. MetaMask terbuka → **Connect/Approve**.
   → Di bawahnya harus tertulis **Custom (11155111) network**.
3. **CONTRACT** → pilih **`SIEMLogger - contracts/SIEMLogger.sol`**.
4. Constructor kosong → klik **Deploy**.
5. MetaMask → **Confirm** (butuh gas testnet ±2.9 juta gas).
6. Kontrak muncul di **Deployed Contracts** (kiri bawah) + baris `[vm] from:0x6BBd… to:SIEMLogger.(constructor) … hash:0x…` di terminal Remix.

## 4. Catat dua hal (kirim ke saya nanti)

```text
Contract Address : 0x......................................................
Deploy tx hash   : 0x......................................................
Waktu deploy     : <YYYY-MM-DD HH:MM WIB>
```

- Contract address: ikon copy di sebelah nama kontrak pada **Deployed Contracts**, atau dari MetaMask → **Activity → Contract Deployment**.
- Tx hash: klik transaksi deploy di **Activity** lalu copy hash-nya.
- Cek cepat: buka `https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>` → harus muncul **Contract Creation** sukses.

## 5. Verifikasi kontrak baru (Read Contract — tanpa gas)

Buka **Deployed Contracts → SIEMLogger** → klik panah ke bawah fungsi-fungsi ini:

| Fungsi | Input | Hasil yang harus muncul |
|---|---|---|
| `VERSION` | — | `4.0.0` ✅ |
| `getRoleName` | `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` | `ADMIN` ✅ |
| `getAssetCount` | — | `0` ✅ |
| `getAssetIds` | — | `[]` ✅ |
| `canManageAssets` | `0x6BBd8F8c13dF812fbDEB6E13145E82F7c74e9297` | `true` ✅ |

Kalau `VERSION` masih `3.0.0` → **kamu sedang menunjuk kontrak lama**; deploy ulang (langkah 3).

## 6. Daftarkan ULANG role (role tidak ikut pindah saat redeploy)

Masih di **Deployed Contracts → SIEMLogger**, transaksi dikirim dari akun owner
(`0x6BBd…`, otomatis ADMIN). Setelah tiap transaksi, klik **Confirm** di MetaMask.

| # | Fungsi | Nilai | Cek |
|---|---|---|---|
| 1 | `addAnalyst` | `0x78ab74A8d8AA1490ECB3F806fE1e25f40DcF88a0` (Yasin) | `getRoleName(0x78ab…)` → `SOC_ANALYST` |
| 2 | `addAuditor` | `0x<alamat Nat>` — **kalau alamatnya masih belum ada, lewati dulu** | `getRoleName(<alamat>)` → `AUDITOR` |

> Kalau nanti Nat belum juga kasih alamat: AUDITOR bisa didemokan pakai akun MetaMask
> kedua milikmu sendiri (impor akun uji) supaya matriks 3 role tetap terlihat
> di testnet. Jangan pakai akun yang sama dengan owner.

## 7. Uji CRUD aset di testnet (bahan laporan — catat tx hash-nya)

Tulis transaksi (fungsi di bagian **Write Contract**-nya Remix), tiap kali **Confirm** di MetaMask:

| Urutan | Fungsi | Argumen persis | Catat |
|---|---|---|---|
| INSERT | `createAsset` | `ASSET-001`, `Server Dell R740`, `hardware`, `Rack A1` | tx hash #1 + gas |
| VIEW | `getAsset` | `ASSET-001` | hasil: name/kategori/lokasi + `createdBy` = `0x6BBd…` |
| UPDATE | `updateAsset` | `ASSET-001`, `Server Dell R740 (v2)`, `hardware`, `Rack B2` | tx hash #2 + gas |
| DELETE | `deleteAsset` | `ASSET-001` | tx hash #3 + gas |

Sesudah DELETE, `getAsset("ASSET-001")` harus **error/revert** (data benar-benar hilang)
dan `getAssetCount` kembali `0`. Event `AssetCreated`/`AssetUpdated`/`AssetDeleted`
tetap permanen di blockchain — ini menarik untuk dibahas di laporan (delete ≠ hilang dari riwayat).

Bonus kalau mau: udahin RBAC di testnet — kirim `updateAsset` dari akun Yasin (SOC_ANALYST)
→ harus **berhasil**; `deleteAsset` dari akun Yasin → harus **revert** (hanya ADMIN).

## 8. (Opsional, nilai tambah) Verify di Etherscan

`https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>` → tab **Contract** → **Verify and Publish**:
Compiler `0.8.26` · Optimization `Yes` runs `200` · EVM `paris` · Contract name `SIEMLogger` → paste isi `.sol` → Verify.
Kalau sukses muncul tab **Read/Write Contract** — cara termudah buat Yasin/Joseph ngetes tanpa Remix.

## 9. Kirim ke saya (biar saya rapikan repo lewat PR)

Isi ini dan kirim apa adanya:

```text
CONTRACT_ADDRESS=0x........
DEPLOY_TX=0x........
WAKTU=2026-..-.. ..:.. WIB
ROLE_YASIN=ok/gagal
ASSET: INSERT tx=0x.... | UPDATE tx=0x.... | DELETE tx=0x....
```

Yang saya kerjakan setelah itu: update `deployments.json` (slot `11155111`), alamat di
`HANDOVER.md` + `README.md`, dan `DEPLOY.md` (RPC 404 sudah diganti). **Semua ini sudah
dikerjakan pada 11 Nov 2026** — dokumen ini sekarang jadi catatan cara melakukannya.

---

## Kalau ada masalah

| Gejala | Solusi |
|---|---|
| MetaMask tidak muncul saat Deploy | ENVIRONMENT belum `Injected Provider - MetaMask`. |
| `insufficient funds for gas` | saldo faucet habis/kurang dari 2.9 juta gas → ambil faucet lagi. |
| Remix `Contract not found` | belum compile, atau nama kontrak di dropdown beda. |
| `SameRole` | role yang diset sama dengan yang sekarang (mis. `addAnalyst` dua kali). |
| `CannotChangeOwner` | kamu mencoba mengubah role akun owner — memang dilarang. |
| `NotAdmin` / `NotOperator` | akun pengirim rolenya kurang; kirim dari `0x6BBd…`. |
| Deploy jalan tapi alamatnya sama dengan kontrak lama | kamu tidak deploy, cuma connect. Cek `VERSION()` — kalau `3.0.0`, deploy ulang. |

Sumber lengkap: [`DEPLOY.md`](DEPLOY.md) · konteks proyek: [`STATUS.md`](STATUS.md).
