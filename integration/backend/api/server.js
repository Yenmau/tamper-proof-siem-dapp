#!/usr/bin/env node
// integration/backend/api/server.js
//
// API OFF-CHAIN (Express + MongoDB) — sisi "Off-chain State Management" pada brief.
//
// Yang dikelola di sini: DATA USER (nama, email, departemen, status aktif).
// Data ini sengaja TIDAK disimpan di blockchain (mahal & publik), sementara
// hash log + registry aset + role akun tetap on-chain.
//
// Endpoint (semua butuh tanda tangan wallet, lihat lib/auth.js):
//   GET    /api/health                 cek hidup (tanpa auth)
//   GET    /api/users                  READ   — role: ADMIN / SOC_ANALYST / AUDITOR
//   GET    /api/users/:wallet          READ
//   POST   /api/users                  INSERT — role: ADMIN / SOC_ANALYST
//   PUT    /api/users/:wallet          UPDATE — role: ADMIN / SOC_ANALYST
//   DELETE /api/users/:wallet          DELETE — role: ADMIN saja
//
// Jalankan:
//   node integration/backend/api/server.js
// Env: RPC_URL, CONTRACT_ADDRESS, MONGO_URI, PORT (default 8089), STATE_DIR

const fs = require("fs");
const path = require("path");
const express = require("express");
const { ethers } = require("ethers");

const users = require("./lib/users");
const auth = require("./lib/auth");

const PORT = Number(process.env.PORT || 8089);
const STATE_DIR = process.env.STATE_DIR || "/state";

// ---------------------------------------------------------------------------
// Konfigurasi: alamat kontrak boleh datang dari env, atau dari volume /state
// (hasil service `deploy` di docker compose) supaya tidak perlu disalin manual.
// ---------------------------------------------------------------------------
function bacaState(nama) {
  try {
    const p = path.join(STATE_DIR, nama);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch (_) {
    /* diabaikan: /state opsional */
  }
  return "";
}

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || bacaState("contract-address.txt");

const ABI_ROLE = ["function getRoleName(address) view returns (string)"];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = CONTRACT_ADDRESS ? new ethers.Contract(CONTRACT_ADDRESS, ABI_ROLE, provider) : null;

// Cache role 15 detik: cukup segar untuk demo, tapi tidak membanjiri RPC
// (setiap request API memanggil kontrak).
const CACHE_MS = 15000;
const cacheRole = new Map(); // alamat -> { role, at }

async function roleOf(wallet) {
  if (!contract) throw new Error("CONTRACT_ADDRESS belum di-set (env atau /state)");
  const key = String(wallet).toLowerCase();
  const c = cacheRole.get(key);
  if (c && Date.now() - c.at < CACHE_MS) return c.role;
  const role = await contract.getRoleName(wallet);
  cacheRole.set(key, { role, at: Date.now() });
  return role;
}

const nonceStore = auth.createNonceStore();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "64kb" }));

// CORS: dashboard dilayani dari origin lain (http://127.0.0.1:8088).
// Tidak memakai cookie, jadi cukup header eksplisit (tanpa kredensial).
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type, x-wallet, x-message, x-signature");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const perlu = (action) => auth.requireWallet(action, { roleOf, nonceStore });

app.get("/api/health", async (req, res) => {
  res.json({
    ok: true,
    layanan: "siem-offchain-api",
    mongo: users.dbState(),
    rpc: RPC_URL,
    contractAddress: CONTRACT_ADDRESS || null,
    roleSumber: "kontrak (getRoleName)",
  });
});

// --- READ -----------------------------------------------------------------
app.get("/api/users", perlu("read"), async (req, res, next) => {
  try {
    const data = await users.listUsers({ q: req.query.q, team: req.query.team, active: req.query.active });
    res.json({ jumlah: data.length, data, dimintaOleh: { wallet: req.wallet, role: req.roleName } });
  } catch (err) {
    next(err);
  }
});

app.get("/api/users/:wallet", perlu("read"), async (req, res, next) => {
  try {
    const u = await users.getUser(req.params.wallet);
    if (!u) return res.status(404).json({ error: "User tidak ditemukan" });
    res.json(u);
  } catch (err) {
    next(err);
  }
});

// --- INSERT ---------------------------------------------------------------
app.post("/api/users", perlu("write"), async (req, res, next) => {
  try {
    const { walletAddress, name, email } = req.body || {};
    if (!walletAddress || !name || !email) {
      return res.status(400).json({ error: "walletAddress, name, dan email wajib diisi" });
    }
    if (!auth.normalizeWallet(walletAddress)) {
      return res.status(400).json({ error: "walletAddress bukan alamat Ethereum yang sah" });
    }
    const doc = await users.createUser(req.body, req.wallet);
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// --- UPDATE ---------------------------------------------------------------
app.put("/api/users/:wallet", perlu("write"), async (req, res, next) => {
  try {
    const doc = await users.updateUser(req.params.wallet, req.body || {}, req.wallet);
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// --- DELETE (hanya ADMIN) -------------------------------------------------
app.delete("/api/users/:wallet", perlu("delete"), async (req, res, next) => {
  try {
    const hasil = await users.deleteUser(req.params.wallet);
    res.json(hasil);
  } catch (err) {
    next(err);
  }
});

app.get("/", (req, res) => {
  res.json({
    layanan: "SIEM Off-Chain API",
    keterangan: "Data user (off-chain). Semua endpoint /api/users butuh tanda tangan wallet + role on-chain.",
    izin: auth.ACTION_ROLES,
    endpoint: [
      "GET /api/health",
      "GET /api/users?q=&team=&active=",
      "GET /api/users/:wallet",
      "POST /api/users",
      "PUT /api/users/:wallet",
      "DELETE /api/users/:wallet",
    ],
  });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[api]", err);
  res.status(status).json({ error: err.message || "Kesalahan server" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  console.log("─".repeat(70));
  console.log("SIEM OFF-CHAIN API (data user di MongoDB)");
  console.log("RPC      :", RPC_URL);
  console.log("Kontrak  :", CONTRACT_ADDRESS || "(kosong — role tidak bisa dibaca)");
  console.log("Mongo    :", users.MONGO_URI);
  console.log("Port     :", PORT);
  console.log("─".repeat(70));

  try {
    await users.connect();
    console.log("[api] MongoDB tersambung");
  } catch (err) {
    // API tetap hidup supaya /api/health bisa melaporkan masalahnya dengan jelas.
    console.error("[api] ⚠️  gagal menyambung MongoDB:", err.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[api] siap di http://0.0.0.0:${PORT}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { app, roleOf, RPC_URL, CONTRACT_ADDRESS };
