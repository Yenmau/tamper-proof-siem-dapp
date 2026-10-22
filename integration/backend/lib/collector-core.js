"use strict";
/**
 * collector-core.js — utilitas bersama untuk logCollector.js & merkleCollector.js
 * -----------------------------------------------------------------------------
 * Sebelumnya kedua skrip menduplikasi ~60% kode (die, loadAbi, sha256,
 * explainError, connect). Perubahan pada satu skrip tidak ikut ke skrip lain,
 * jadi rawan divergen. Semua bagian yang sama sekarang ada di sini.
 *
 * TIDAK ada perubahan algoritma:
 *   - mode "file"   : logHash = SHA-256 seluruh isi file  (logCollector.js)
 *   - mode "merkle" : logHash = Merkle Root dari hash tiap baris (merkleCollector.js)
 * Keduanya memanggil fungsi kontrak yang sama (`recordLogHash`,
 * `verifyLogIntegrityView`, `verifyLogIntegrity`).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");

// .env dibaca relatif terhadap lokasi skrip (integration/backend/.env), bukan
// current working directory, supaya skrip bisa dijalankan dari root repo.
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

// ---------------------------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_ABI_PATH = path.join(REPO_ROOT, "contracts", "SIEMLogger.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ABI_PATH = process.env.ABI_PATH || DEFAULT_ABI_PATH;
const MONGO_URI = (process.env.MONGO_URI || "").trim();

/** Penanda khusus kalau file log sudah tidak ada (dihapus penyerang). */
const HASH_FILE_MISSING = "0x__LOG_FILE_MISSING__";
/** Penanda khusus kalau file log ada tapi tidak punya baris berisi. */
const HASH_FILE_EMPTY = "0x__LOG_FILE_EMPTY__";

const MODE_FILE = "file";
const MODE_MERKLE = "merkle";
const MODE_LABEL = { file: "SHA-256 file utuh", merkle: "Merkle Root (hash per baris)" };

// ---------------------------------------------------------------------------
// Util dasar
// ---------------------------------------------------------------------------
function die(msg) {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}

function short(h) {
  return typeof h === "string" && h.length > 18 ? h.slice(0, 10) + "…" + h.slice(-6) : String(h);
}

function printBanner(title, rows) {
  const line = "─".repeat(70);
  console.log(line);
  console.log(title);
  for (const [label, value] of rows) console.log(label.padEnd(9, " ") + ": " + value);
  console.log(line);
}

function argNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
function sha256Hex(buf) {
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) die("File log tidak ditemukan: " + filePath);
  return sha256Hex(fs.readFileSync(filePath));
}

/** Baris-baris log yang berisi (baris kosong dibuang). null kalau file hilang. */
function readLogLines(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

function leafHash(line) {
  return crypto.createHash("sha256").update(line).digest();
}

/**
 * Merkle Root dari daftar baris. Mengembalikan null kalau tidak ada baris —
 * pemanggil yang memutuskan artinya (lihat hashForMode).
 */
function merkleRootOfLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const tree = new MerkleTree(lines.map(leafHash), leafHash, { sortPairs: true });
  const root = tree.getHexRoot();
  // merkletreejs mengembalikan "0x" (bukan error) untuk pohon kosong; panjang
  // root yang sah selalu 66 karakter (0x + 32 byte).
  if (typeof root !== "string" || root.length !== 66) {
    die("Merkle Root tidak valid (" + JSON.stringify(root) + ") untuk " + lines.length + " baris.");
  }
  return root;
}

/**
 * Nilai yang akan dikirim sebagai `logHash` untuk sebuah mode.
 * @returns {{hash: string, detail: string, lines: string[]|null, missing: boolean, empty: boolean}}
 */
function hashForMode(mode, filePath) {
  if (!fs.existsSync(filePath)) {
    return { hash: HASH_FILE_MISSING, detail: "file log tidak ada di server", lines: null, missing: true, empty: false };
  }
  if (mode === MODE_FILE) {
    return {
      hash: sha256Hex(fs.readFileSync(filePath)),
      detail: "SHA-256 seluruh isi file",
      lines: readLogLines(filePath),
      missing: false,
      empty: false,
    };
  }
  const lines = readLogLines(filePath) || [];
  if (lines.length === 0) {
    return {
      hash: HASH_FILE_EMPTY,
      detail: "file ada, tapi 0 baris berisi",
      lines,
      missing: false,
      empty: true,
    };
  }
  return {
    hash: merkleRootOfLines(lines),
    detail: lines.length + " baris → Merkle Root",
    lines,
    missing: false,
    empty: false,
  };
}

// ---------------------------------------------------------------------------
// Blockchain
// ---------------------------------------------------------------------------
function loadAbi() {
  if (!fs.existsSync(ABI_PATH)) die("File ABI tidak ditemukan: " + ABI_PATH);
  return JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
}

async function connect() {
  if (!CONTRACT_ADDRESS) die("ENV CONTRACT_ADDRESS belum di-set (lihat integration/backend/.env).");
  if (!PRIVATE_KEY) die("ENV PRIVATE_KEY belum di-set (lihat integration/backend/.env).");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, loadAbi(), wallet);
  return { provider, wallet, contract };
}

/** Terjemahkan revert custom error jadi pesan yang enak dibaca. */
function explainError(contract, err) {
  const data = err?.data || err?.info?.error?.data;
  if (data && contract) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) {
        if (parsed.name === "NotOperator") {
          return "NotOperator — akun ini belum punya role SOC_ANALYST/ADMIN. Minta owner memanggil addAnalyst(<alamat>) dulu.";
        }
        if (parsed.name === "NotAdmin") return "NotAdmin — perlu role ADMIN.";
        if (parsed.name === "LogAlreadyExists") {
          return "LogAlreadyExists — logId '" + parsed.args[0] + "' sudah pernah didaftarkan. Pakai logId baru.";
        }
        if (parsed.name === "LogNotFound") {
          return "LogNotFound — logId '" + parsed.args[0] + "' belum pernah didaftarkan. Jalankan mode record dulu.";
        }
        return parsed.name + "(" + parsed.args.join(", ") + ")";
      }
    } catch (_) {
      /* jatuh ke bawah */
    }
  }
  return err?.shortMessage || err?.message || String(err);
}

function explorerLink(txHash) {
  if (RPC_URL.includes("sepolia")) return "https://sepolia.etherscan.io/tx/" + txHash;
  if (RPC_URL.includes("amoy")) return "https://amoy.polygonscan.com/tx/" + txHash;
  return null;
}

async function roleNameSafe(contract, addr) {
  try {
    return await contract.getRoleName(addr);
  } catch (_) {
    return "(tidak bisa dibaca)";
  }
}

/** Ambil `logHash` yang tersimpan on-chain untuk sebuah logId (null kalau belum ada). */
async function onChainHashOf(contract, logId) {
  try {
    const status = await contract.getLogStatus(logId);
    const hash = status[0];
    return typeof hash === "string" && hash.length > 0 ? hash : null;
  } catch (_) {
    return null; // belum terdaftar (LogNotFound)
  }
}

/**
 * Deteksi "salah skrip": logId ini sebenarnya direkam oleh mode yang lain.
 *
 * Kenapa perlu: mode "file" dan mode "merkle" mengirim nilai berbeda untuk file
 * yang sama, jadi pengecekan silang akan melaporkan TAMPERED palsu — dan
 * `isTampered` on-chain tidak bisa dibalik ke false. Kalau hash on-chain sama
 * dengan hasil hitung mode LAIN untuk file yang sama, kita tahu itu bukan
 * tampering, hanya beda mode → alarm TIDAK dikirim.
 *
 * @returns {Promise<null|{otherMode: string, storedHash: string}>}
 */
async function detectModeMismatch(contract, logId, filePath, myMode) {
  const storedHash = await onChainHashOf(contract, logId);
  if (!storedHash) return null;
  const otherMode = myMode === MODE_FILE ? MODE_MERKLE : MODE_FILE;
  let otherHash = null;
  try {
    otherHash = hashForMode(otherMode, filePath).hash;
  } catch (_) {
    return null;
  }
  if (otherHash && storedHash.toLowerCase() === String(otherHash).toLowerCase()) {
    return { otherMode, storedHash };
  }
  return null;
}

module.exports = {
  REPO_ROOT,
  DEFAULT_ABI_PATH,
  ABI_PATH,
  CONTRACT_ADDRESS,
  MONGO_URI,
  HASH_FILE_MISSING,
  HASH_FILE_EMPTY,
  MODE_FILE,
  MODE_MERKLE,
  MODE_LABEL,
  die,
  short,
  printBanner,
  argNumber,
  sha256Hex,
  sha256File,
  readLogLines,
  merkleRootOfLines,
  hashForMode,
  loadAbi,
  connect,
  explainError,
  explorerLink,
  roleNameSafe,
  onChainHashOf,
  detectModeMismatch,
};
