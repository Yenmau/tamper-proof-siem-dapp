#!/usr/bin/env node
/**
 * merkleCollector.js — Backend Log Collector dengan Merkle Tree
 * ------------------------------------------------------------------
 * Membaca file log baris demi baris, membangun Merkle Tree untuk mendapatkan
 * Merkle Root, lalu menyimpan Root tersebut ke Smart Contract (On-Chain).
 * Sementara itu, log mentah akan disimpan ke MongoDB (Off-Chain) untuk efisiensi.
 */

require('dotenv').config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const mongoose = require("mongoose");

// ---------------------------------------------------------------------------
// Konfigurasi Environment
// ---------------------------------------------------------------------------
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ABI_PATH = process.env.ABI_PATH || path.resolve(__dirname, "../../contracts/SIEMLogger.json");

// Tambahkan dukungan MONGO_URI
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/siem_logs";

// ---------------------------------------------------------------------------
// Skema MongoDB
// ---------------------------------------------------------------------------
const logSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  merkleRoot: { type: String, required: true },
  lines: [
    {
      index: Number,
      content: String,
      hash: String
    }
  ],
  createdAt: { type: Date, default: Date.now }
});
const LogModel = mongoose.model("LogBatch", logSchema);

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function die(msg) {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}

function loadAbi() {
  if (!fs.existsSync(ABI_PATH)) die("File ABI tidak ditemukan: " + ABI_PATH);
  return JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
}

/** Fungsi Hash untuk Merkle Tree menggunakan SHA-256 */
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest();
}

/** Mendapatkan array baris log dan menghilangkan baris kosong */
function getLogLines(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).filter(line => line.trim() !== "");
}

/** Terjemahkan revert custom error jadi pesan yang enak dibaca. */
function explainError(contract, err) {
  const data = err?.data || err?.info?.error?.data;
  if (data && contract) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) {
        if (parsed.name === "NotOperator") return "NotOperator — butuh role SOC_ANALYST/ADMIN.";
        if (parsed.name === "LogAlreadyExists") return "LogAlreadyExists — logId sudah ada.";
        return parsed.name + "(" + parsed.args.join(", ") + ")";
      }
    } catch (_) {}
  }
  return err?.shortMessage || err?.message || String(err);
}

async function connectEthereum() {
  if (!CONTRACT_ADDRESS) die("ENV CONTRACT_ADDRESS belum di-set.");
  if (!PRIVATE_KEY) die("ENV PRIVATE_KEY belum di-set.");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, loadAbi(), wallet);
  return { provider, wallet, contract };
}

async function connectMongo() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Terhubung ke MongoDB:", MONGO_URI);
  } catch (err) {
    die("Gagal koneksi ke MongoDB: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Mode: record
// ---------------------------------------------------------------------------
async function cmdRecord(logFile, logId) {
  const { provider, wallet, contract } = await connectEthereum();
  await connectMongo();

  const lines = getLogLines(logFile);
  if (!lines || lines.length === 0) die("File log kosong atau tidak ditemukan.");

  // Membangun Merkle Tree
  const leaves = lines.map(line => sha256(line));
  const tree = new MerkleTree(leaves, sha256, { sortPairs: true });
  const rootHash = tree.getHexRoot();

  console.log("─".repeat(70));
  console.log("MODE       : record (Merkle Tree)");
  console.log("Akun       :", wallet.address);
  console.log("File log   :", logFile);
  console.log("Total Baris:", lines.length);
  console.log("Merkle Root:", rootHash);
  console.log("─".repeat(70));

  // Menyimpan Log secara Off-Chain di MongoDB
  try {
    const existingLog = await LogModel.findOne({ logId });
    if (existingLog) die(`Log ID ${logId} sudah tersimpan di database.`);

    const logDocs = lines.map((content, index) => ({
      index,
      content,
      hash: "0x" + leaves[index].toString("hex")
    }));

    await LogModel.create({
      logId,
      merkleRoot: rootHash,
      lines: logDocs
    });
    console.log("✅ Data log mentah tersimpan di MongoDB.");
  } catch (err) {
    die("Error MongoDB: " + err.message);
  }

  // Merekam ke Smart Contract
  try {
    const tx = await contract.recordLogHash(logId, rootHash);
    console.log("⏳ Mengirim transaksi ke blockchain...");
    await tx.wait();
    console.log("✅ Merkle Root terkunci on-chain.");
  } catch (err) {
    console.error("❌ Transaksi gagal:", explainError(contract, err));
  }

  mongoose.disconnect();
}

// ---------------------------------------------------------------------------
// Mode: watch
// ---------------------------------------------------------------------------
async function cmdWatch(logFile, logId) {
  const { provider, wallet, contract } = await connectEthereum();
  await connectMongo();
  
  console.log("─".repeat(70));
  console.log("MODE     : watch (Cek Integritas Merkle Tree)");
  console.log("Akun     :", wallet.address);
  console.log("File log :", logFile);
  console.log("logId    :", logId);
  console.log("─".repeat(70));

  const dbLog = await LogModel.findOne({ logId });
  if (!dbLog) die(`Log ID ${logId} tidak ditemukan di database MongoDB.`);

  const lines = getLogLines(logFile);
  
  // Jika file hilang
  if (!lines) {
    console.log("🔴 FILE LOG HILANG! Mengirim alarm ke on-chain...");
    const tx = await contract.verifyLogIntegrity(logId, "0x__LOG_FILE_MISSING__");
    await tx.wait();
    console.log("✅ Alarm Tampering terkirim on-chain.");
    process.exit(0);
  }

  // Kalkulasi ulang Merkle Root
  const leaves = lines.map(line => sha256(line));
  const tree = new MerkleTree(leaves, sha256, { sortPairs: true });
  const currentRootHash = tree.getHexRoot() || "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Cek integritas gratis (View function)
  let isMatch = false;
  try {
    isMatch = await contract.verifyLogIntegrityView(logId, currentRootHash);
  } catch (err) {
    die(explainError(contract, err));
  }

  if (isMatch) {
    console.log("🟢 AMAN. Merkle Root log server cocok dengan on-chain.");
  } else {
    console.log(`🔴 TAMPERED! Merkle Root server (${currentRootHash}) ≠ on-chain.`);
    
    // Temukan detail perubahan (baris mana yang beda)
    console.log("🔍 Melakukan Analisis Baris Log...");
    for (let i = 0; i < Math.max(lines.length, dbLog.lines.length); i++) {
       const dbLine = dbLog.lines[i];
       const curLine = lines[i];
       if (!dbLine) {
         console.log(`   [TAMBAHAN] Baris ke-${i}: ${curLine}`);
       } else if (!curLine) {
         console.log(`   [DIHAPUS] Baris ke-${i} dihapus.`);
       } else if (dbLine.content !== curLine) {
         console.log(`   [DIUBAH] Baris ke-${i}:`);
         console.log(`       Asli: ${dbLine.content}`);
         console.log(`       Baru: ${curLine}`);
       }
    }

    console.log("⏳ Mengirim transaksi alarm (verifyLogIntegrity) ke on-chain...");
    try {
      const tx = await contract.verifyLogIntegrity(logId, currentRootHash);
      await tx.wait();
      console.log("✅ Alarm Tampering berhasil dicatat di blockchain.");
    } catch(err) {
       console.error("❌ Gagal mengirim alarm:", explainError(contract, err));
    }
  }

  mongoose.disconnect();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const [mode, logFile, logId] = process.argv.slice(2);

  if (mode === "record") {
    if (!logFile || !logId) die("Pakai: node merkleCollector.js record <fileLog> <logId>");
    await cmdRecord(logFile, logId);
  } else if (mode === "watch") {
    if (!logFile || !logId) die("Pakai: node merkleCollector.js watch <fileLog> <logId>");
    await cmdWatch(logFile, logId);
  } else {
    console.log(`
merkleCollector.js — Backend Log Collector (Tamper-Proof SIEM dApp)

  node merkleCollector.js record <fileLog> <logId>
  node merkleCollector.js watch  <fileLog> <logId>
`);
  }
}

main().catch((e) => die(e.message || String(e)));
