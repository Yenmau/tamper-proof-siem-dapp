#!/usr/bin/env node
// integration/backend/api/smoke-test.js
//
// Uji end-to-end API off-chain TERHADAP SERVER YANG SEDANG JALAN:
// login wallet (tanda tangan) -> role dibaca dari kontrak -> CRUD data user.
// Sekaligus menguji kasus yang HARUS gagal (tanpa tanda tangan, role kurang,
// tanda tangan dipakai ulang, data duplikat).
//
// Jalankan (stack `docker compose` sudah hidup):
//   node integration/backend/api/smoke-test.js
//
// Env opsional:
//   API_BASE_URL   default http://127.0.0.1:8089
//   RPC_URL        default http://127.0.0.1:8545
//   CONTRACT_ADDRESS  (kalau kosong dibaca dari /state atau deployments.json)
//
// Private key di bawah adalah akun dev bawaan Hardhat (PUBLIK, hanya untuk node
// lokal) — bukan rahasia, dan tidak dipakai di testnet.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const auth = require("./lib/auth");

const API = process.env.API_BASE_URL || "http://127.0.0.1:8089";
const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";

const AKUN = {
  admin: process.env.ADMIN_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  analyst: process.env.ANALYST_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  auditor: process.env.AUDITOR_KEY || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  outsider: process.env.OUTSIDER_KEY || "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
};

const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "contracts", "SIEMLogger.json"), "utf8"));

let lulus = 0;
let gagal = 0;
const baris = [];

function catat(nama, ok, info) {
  if (ok) {
    lulus++;
    baris.push(`  ✔ ${nama}${info ? `  (${info})` : ""}`);
  } else {
    gagal++;
    baris.push(`  ✘ ${nama}  -> ${info}`);
  }
}

/**
 * Cari alamat kontrak yang BENAR-BENAR dipakai stack yang sedang jalan.
 * Urutan: env -> /state (isi container) -> /api/health (paling akurat untuk
 * stack docker) -> deployments.json. Tanpa urutan ini, skrip di host bisa
 * mengambil alamat Sepolia dari deployments.json padahal yang jalan adalah
 * chain lokal -> `getRoleName` gagal decode.
 */
async function alamatKontrak() {
  if (process.env.CONTRACT_ADDRESS) return process.env.CONTRACT_ADDRESS;
  try {
    const res = await fetch(`${API}/api/health`);
    const h = await res.json();
    if (h && h.contractAddress) return h.contractAddress;
  } catch (_) {
    /* API belum jalan; coba sumber lain */
  }
  for (const p of ["/state/contract-address.txt", path.join(__dirname, "..", "..", "..", "deployments.json")]) {
    try {
      if (!fs.existsSync(p)) continue;
      const isi = fs.readFileSync(p, "utf8").trim();
      if (isi.startsWith("{")) {
        const d = JSON.parse(isi);
        const k = Object.keys(d).find((x) => d[x] && d[x].address);
        if (k) return d[k].address;
      } else {
        return isi;
      }
    } catch (_) {
      /* lanjut */
    }
  }
  return "";
}

/** Panggil API dengan tanda tangan wallet (atau tanpa, kalau wallet = null). */
async function panggil(method, jalur, { wallet, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (wallet) {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = ethers.hexlify(ethers.randomBytes(8));
    const message = auth.buildMessage({ wallet: wallet.address, ts, nonce });
    headers["x-wallet"] = wallet.address;
    headers["x-message"] = auth.encodeMessage(message);
    headers["x-signature"] = await wallet.signMessage(message);
  }
  const res = await fetch(`${API}${jalur}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* respons tanpa body */
  }
  return { status: res.status, data, headers };
}

async function main() {
  console.log(`\nUji end-to-end API off-chain  ->  ${API}\n`);

  const admin = new ethers.Wallet(AKUN.admin);
  const analyst = new ethers.Wallet(AKUN.analyst);
  const auditor = new ethers.Wallet(AKUN.auditor);
  const outsider = new ethers.Wallet(AKUN.outsider);

  // 1. health
  const h = await panggil("GET", "/api/health");
  catat("health: API hidup & MongoDB tersambung", h.status === 200 && h.data?.mongo === "tersambung", JSON.stringify(h.data?.mongo));

  // 2. tanpa tanda tangan
  const tanpa = await panggil("GET", "/api/users");
  catat("tanpa login wallet -> 401", tanpa.status === 401, `status ${tanpa.status}`);

  // 3. siapkan role on-chain (butuh akun ADMIN)
  const addr = await alamatKontrak();
  if (!addr) throw new Error("CONTRACT_ADDRESS tidak ditemukan (env / /state / deployments.json)");
  // cacheTimeout: -1 -> matikan cache internal ethers. Tanpa ini,
  // getTransactionCount bisa mengembalikan nonce lama saat dua transaksi
  // dikirim berurutan cepat ("Nonce too low").
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const c = new ethers.Contract(addr, ABI, admin.connect(provider));
  const setRole = async (akun, fn) => {
    const now = await c.getRoleName(akun.address);
    if (now !== "NONE") return now;
    // Nonce diambil eksplisit: dua transaksi berurutan dari akun yang sama
    // bisa bentrok karena ethers.Wallet menyimpan nonce-nya sendiri.
    const nonce = await provider.getTransactionCount(admin.address, "pending");
    await (await c[fn](akun.address, { nonce })).wait();
    return c.getRoleName(akun.address);
  };
  const roleAnalyst = await setRole(analyst, "addAnalyst");
  const roleAuditor = await setRole(auditor, "addAuditor");
  catat("kontrak: role uji disiapkan on-chain", roleAnalyst === "SOC_ANALYST" && roleAuditor === "AUDITOR", `analyst=${roleAnalyst}, auditor=${roleAuditor}`);
  catat("kontrak: akun luar tidak punya role", (await c.getRoleName(outsider.address)) === "NONE", await c.getRoleName(outsider.address));

  // 4. akun tanpa role ditolak
  const cobaLuar = await panggil("GET", "/api/users", { wallet: outsider });
  catat("role NONE -> 403 (dibaca dari kontrak)", cobaLuar.status === 403, `status ${cobaLuar.status}: ${cobaLuar.data?.detail || ""}`);

  // 5. INSERT (ADMIN) — bersihkan dulu supaya skrip ini boleh dijalankan ulang
  const target = "0x" + "ab".repeat(20);
  await panggil("DELETE", `/api/users/${target}`, { wallet: admin });
  const buat = await panggil("POST", "/api/users", {
    wallet: admin,
    body: { walletAddress: target, name: "Budi Santoso", email: "budi@contoh.id", department: "SOC", team: "Blue Team", notes: "dibuat oleh smoke test" },
  });
  catat("INSERT (ADMIN) -> 201", buat.status === 201, `status ${buat.status}: ${buat.data?.error || buat.data?.name}`);

  // 6. duplikat
  const dup = await panggil("POST", "/api/users", {
    wallet: admin,
    body: { walletAddress: target, name: "Duplikat", email: "dup@contoh.id" },
  });
  catat("INSERT duplikat -> 409", dup.status === 409, `status ${dup.status}`);

  // 7. READ daftar & satu
  const daftar = await panggil("GET", "/api/users", { wallet: analyst });
  catat("READ daftar (SOC_ANALYST) -> 200 & berisi", daftar.status === 200 && daftar.data?.data?.some((u) => u.walletAddress === target), `jumlah ${daftar.data?.jumlah}`);

  const satu = await panggil("GET", `/api/users/${target}`, { wallet: auditor });
  catat("READ satu (AUDITOR) -> 200", satu.status === 200 && satu.data?.email === "budi@contoh.id", `status ${satu.status}`);

  // 8. UPDATE (SOC_ANALYST)
  const ubah = await panggil("PUT", `/api/users/${target}`, {
    wallet: analyst,
    body: { department: "Incident Response", active: false },
  });
  catat("UPDATE (SOC_ANALYST) -> 200 & berubah", ubah.status === 200 && ubah.data?.department === "Incident Response" && ubah.data?.active === false, `status ${ubah.status}`);
  catat("UPDATE mencatat updatedBy = wallet pelaku", String(ubah.data?.updatedBy).toLowerCase() === analyst.address.toLowerCase(), ubah.data?.updatedBy);

  // 9. AUDITOR tidak boleh menulis
  const auditorNulis = await panggil("PUT", `/api/users/${target}`, { wallet: auditor, body: { name: "Auditor Coba Ubah" } });
  catat("UPDATE oleh AUDITOR -> 403", auditorNulis.status === 403, `status ${auditorNulis.status}`);

  // 10. DELETE hanya ADMIN
  const analystHapus = await panggil("DELETE", `/api/users/${target}`, { wallet: analyst });
  catat("DELETE oleh SOC_ANALYST -> 403", analystHapus.status === 403, `status ${analystHapus.status}`);

  const hapus = await panggil("DELETE", `/api/users/${target}`, { wallet: admin });
  catat("DELETE oleh ADMIN -> 200", hapus.status === 200 && hapus.data?.deleted === true, `status ${hapus.status}`);

  const sesudah = await panggil("GET", `/api/users/${target}`, { wallet: admin });
  catat("data benar-benar hilang (GET -> 404)", sesudah.status === 404, `status ${sesudah.status}`);

  // 11. replay tanda tangan
  const ts = Math.floor(Date.now() / 1000);
  const nonceUnik = "replay-" + ethers.hexlify(ethers.randomBytes(6)).slice(2);
  const message = auth.buildMessage({ wallet: admin.address, ts, nonce: nonceUnik });
  const signature = await admin.signMessage(message);
  const hdr = { "x-wallet": admin.address, "x-message": auth.encodeMessage(message), "x-signature": signature };
  const r1 = await fetch(`${API}/api/users`, { headers: hdr });
  const r2 = await fetch(`${API}/api/users`, { headers: hdr });
  catat("tanda tangan sekali pakai: pertama 200, kedua 409", r1.status === 200 && r2.status === 409, `${r1.status} lalu ${r2.status}`);

  console.log(baris.join("\n"));
  console.log(`\n${lulus} lulus, ${gagal} gagal\n`);
  if (gagal) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ smoke test gagal dijalankan:", err.message);
  process.exit(1);
});
