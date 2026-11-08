# 📍 STATUS PROYEK — checkpoint 8 November 2026

Catatan "sampai mana kita". Ditulis oleh Vincent (#1) supaya bisa dilanjutkan
kapan saja tanpa membaca ulang seluruh riwayat. Fakta di bawah ini hasil
**eksekusi nyata**, bukan rencana.

- `main` terakhir: commit `8241662` (PR #11 merged) — CI **hijau 3/3**
- PR terbuka: **0** · Issue terbuka: **0**
- `contracts/SIEMLogger.sol` **tidak disentuh** sejak v3.0 (ABI, bytecode, alamat Sepolia tetap sama)

---

## 1. Ringkasan singkat

| Bagian | Pemilik | Status |
|---|---|---|
| #1 Smart contract + RBAC + deploy Sepolia | Vincent | ✅ selesai (live Sepolia) |
| #2 Backend log (SHA-256, Merkle, proof, daemon, batch) | Yasin | ✅ selesai + dibungkus container |
| #3 Infrastruktur (server korban, rsyslog/sshd, log-shipper) | Rafif | ✅ selesai + masuk stack gabungan |
| #5 Frontend SOC Dashboard (React + Vite) | Joseph | ✅ selesai (alarm, detail, bukti Merkle di browser, export) |
| **Integrasi seluruh alur (1 perintah `docker compose`)** | Vincent | ✅ **selesai & diuji end-to-end** |
| #6 Auditor: role `AUDITOR` untuk Nat | Nat | ⏳ nunggu alamat publik |
| #6 Auditor: threat model + laporan audit (CVSS v4.0) | Nat | ❌ belum ada di repo |
| #4 Red Team: skrip/skenario serangan + PoC | Michael | ❌ belum ada artefak di repo (baru dijelaskan di `infra/README.md`) |
| Verifikasi kontrak di Etherscan | Vincent (opsional) | ⏳ Sourcify sudah *exact match*; Etherscan belum |
| Deploy ke Polygon Amoy | Vincent (opsional) | ⏳ `deployments.json` slot `80002` masih kosong |
| Uji profil **Sepolia** pada compose gabungan | Vincent (opsional) | ⚠️ baru divalidasi `compose config`, belum dijalankan end-to-end |

---

## 2. Yang sudah jalan (bukti uji terakhir, 8 Nov 2026)

Dijalankan dari repo kosong: `docker compose --profile local up -d --build`

| Kejadian | Hasil nyata |
|---|---|
| Chain lokal | healthy, chainId 31337 |
| Deploy kontrak | `0x5FbDB2315678afecb367f032d93F642f64180aa3`, alamat ditulis ke volume `/state` |
| Server korban | healthy (sshd + rsyslog + log-shipper), SSH di `127.0.0.1:2222` |
| 12 percobaan SSH gagal | batch 12 baris → `✅ rekam victim-server/auth-… ` **1 transaksi batch, 253.838 gas** |
| Serangan: 1 baris log dihapus | collector `🔴 TAMPERED` → `verifyLogIntegrity` **52.429 gas** → event `TamperingDetected` |
| Dashboard `http://127.0.0.1:8088` | banner **🚨 TAMPERING DETECTED**, judul tab berkedip, badge 🔴 TAMPERED, `LogVerified (TIDAK cocok)` di Event Stream |
| Panel bukti Merkle | `2 dari 2 baris TIDAK TERBUKTI` — dihitung **di browser** (WebCrypto) terhadap Merkle Root on-chain + `verifyLogIntegrityView` 🔴 |
| Idempoten | `up -d` kedua & ketiga: `pakai kontrak yang sudah ada di /state — tidak deploy baru` |
| CI (branch & main) | 3/3 hijau: Hardhat test (15) + backend test (40) + build dashboard + validasi compose |

Perbaikan yang dikerjakan di checkpoint ini (detail + tabel sebelum/sesudah di
[`CHANGELOG.md`](CHANGELOG.md) bagian `[Unreleased]`):

1. alamat kontrak tidak sampai ke dashboard (`COPY` entrypoint + pembacaan `/state`)
2. RPC dashboard memakai nama service Docker → `BROWSER_RPC_URL`
3. `deploy` tidak idempoten → alamat di `/state` pindah tiap `up -d`
4. panel bukti Merkle menampilkan hasil basi setelah log terbukti diubah
5. `hardhat.config.js` belum punya network `localhost` yang ikut `RPC_URL`
6. CI belum menyentuh stack docker (job validasi compose + guard CRLF/syntax `.sh`)

---

## 3. Cara menjalankan (untuk lanjut lain kali)

```bash
cd D:/Projects/tamper-proof-siem-dapp
cp .env.example .env                      # profil lokal tidak perlu diisi
docker compose --profile local up -d --build
```

| Layanan | Alamat di host |
|---|---|
| Dashboard SOC | http://127.0.0.1:8088 |
| RPC chain | http://127.0.0.1:8545 |
| SSH server korban | `ssh -p 2222 victim@127.0.0.1` (password `password123`) |

Uji alarm (dari kondisi hijau):

```bash
docker exec siem-victim sh -c 'f=$(ls /siem-batches/auth-*.log); sed -i "1d" "$f"'
sleep 40
docker logs siem-collector | tail -5      # harus muncul 🔴 TAMPERED + alarm tercatat on-chain
```

Berhenti / reset:

```bash
docker compose --profile local down          # berhenti, data tersimpan
docker compose --profile local down -v       # + hapus chain & /state
find infra/siem-batches -type f ! -name .gitkeep -delete   # wajib kalau chain di-restart
```

> Profil Sepolia (kontrak live, tanpa chain lokal): isi `RPC_URL`,
> `BROWSER_RPC_URL`, `CONTRACT_ADDRESS`, `PRIVATE_KEY` (akun SOC_ANALYST) di
> `.env`, lalu `docker compose up -d --build`.

---

## 4. Langkah lanjutan (urutan yang disarankan)

1. **Nat kirim alamat Ethereum** → Vincent jalankan `addAuditor(<alamat>)` dari
   Remix (akun owner), lalu verifikasi `getRoleName(0x…)` = `AUDITOR`.
   → setelah ini **langkah C point 1 selesai 100%**.
2. Michael menaruh skrip/skenario serangan + PoC di repo (mis. `redteam/`),
   memakai server korban dari stack gabungan di atas.
3. Nat menulis threat model + laporan audit CVSS v4.0.
4. Opsional teknis: verifikasi kontrak di Etherscan, deploy Amoy
   (`deployments.json` slot `80002`), lalu uji profil Sepolia di compose.

---

## 5. Jangan sampai salah (catatan yang sudah menelan waktu)

- Satu `logId` hanya boleh dikelola **satu** skrip backend (`logCollector.js` vs
  `merkleCollector.js` menghasilkan hash berbeda → alarm palsu). Collector
  otomatis menahan alarm dan mencetak `⚠️ SALAH SKRIP` kalau ini terjadi.
- Jangan jalankan `infra/docker-compose.yml` (berdiri sendiri) bersamaan dengan
  `docker-compose.yml` root — nama container, port 2222, dan folder
  `siem-batches` sama.
- Setelah chain di-restart tanpa `down -v`, isi `infra/siem-batches/` harus
  dikosongkan; kalau tidak, collector masih menganggap batch lama terdaftar.
- `main` dilindungi ruleset → semua perubahan lewat branch + PR.
