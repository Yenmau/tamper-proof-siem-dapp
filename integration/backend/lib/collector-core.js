"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_ABI_PATH = path.join(REPO_ROOT, "contracts", "SIEMLogger.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ABI_PATH = process.env.ABI_PATH || DEFAULT_ABI_PATH;
const MONGO_URI = (process.env.MONGO_URI || "").trim();

const HASH_FILE_MISSING = "0x__LOG_FILE_MISSING__";
const HASH_FILE_EMPTY = "0x__LOG_FILE_EMPTY__";

const MODE_FILE = "file";
const MODE_MERKLE = "merkle";
const MODE_LABEL = { file: "SHA-256 file utuh", merkle: "Merkle Root (hash per baris)" };

const PROOFS_SUFFIX = ".proofs.json";
const PROOFS_FORMAT = "siem-merkle-proofs/v1";

function die(msg) {
  console.error("\n[GAGAL] " + msg + "\n");
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

function sha256Hex(buf) {
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) die("File log tidak ditemukan: " + filePath);
  return sha256Hex(fs.readFileSync(filePath));
}

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

function leafHashHex(line) {
  return "0x" + leafHash(line).toString("hex");
}

function merkleProofOfLine(lines, index) {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return [];
  const tree = new MerkleTree(lines.map(leafHash), leafHash, { sortPairs: true });
  return tree.getHexProof(leafHash(lines[index]));
}

function verifyLineProof(line, proof, root) {
  if (typeof line !== "string") return false;
  if (!Array.isArray(proof) || proof.length === 0) return false;
  if (typeof root !== "string" || root.length !== 66) return false;
  try {
    return MerkleTree.verify(proof, leafHash(line), root, leafHash, { sortPairs: true });
  } catch (_) {
    return false;
  }
}

function slugLogId(logId) {
  return (
    String(logId)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "log"
  );
}

function proofsPathFor(logFile, logId) {
  return logFile + "." + slugLogId(logId) + PROOFS_SUFFIX;
}

function buildProofArtifacts(lines, logId, root) {
  const tree = new MerkleTree(lines.map(leafHash), leafHash, { sortPairs: true });
  const computed = tree.getHexRoot();
  if (root && computed.toLowerCase() !== String(root).toLowerCase()) {
    die("Konsistensi gagal: Merkle Root artefak (" + computed + ") ≠ root yang akan dikirim (" + root + ").");
  }
  return {
    format: PROOFS_FORMAT,
    logId,
    merkleRoot: computed,
    algorithm: { hash: "sha256", leaf: "sha256(isi baris)", sortPairs: true },
    generatedAt: new Date().toISOString(),
    lineCount: lines.length,
    lines: lines.map((content, index) => ({
      index,
      content,
      hash: leafHashHex(content),
      proof: tree.getHexProof(leafHash(content)),
    })),
  };
}

function saveProofArtifacts(logFile, artifacts) {
  const target = proofsPathFor(logFile, artifacts.logId);
  fs.writeFileSync(target, JSON.stringify(artifacts, null, 2) + "\n", "utf8");
  return target;
}

function loadProofArtifacts(logFile, logId, fromDb) {
  if (fromDb && Array.isArray(fromDb.lines) && fromDb.lines.length > 0) {
    return {
      source: "mongodb",
      logId: fromDb.logId,
      merkleRoot: fromDb.merkleRoot,
      algorithm: fromDb.algorithm || { hash: "sha256", leaf: "sha256(isi baris)", sortPairs: true },
      lineCount: fromDb.lines.length,
      lines: fromDb.lines,
    };
  }
  const target = proofsPathFor(logFile, logId);
  if (!fs.existsSync(target)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    if (parsed && parsed.logId !== logId) return null;
    return { ...parsed, source: target };
  } catch (_) {
    return null;
  }
}

function merkleRootOfLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const tree = new MerkleTree(lines.map(leafHash), leafHash, { sortPairs: true });
  const root = tree.getHexRoot();
  if (typeof root !== "string" || root.length !== 66) {
    die("Merkle Root tidak valid (" + JSON.stringify(root) + ") untuk " + lines.length + " baris.");
  }
  return root;
}

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

async function connectReadOnly() {
  if (!CONTRACT_ADDRESS) die("ENV CONTRACT_ADDRESS belum di-set (lihat integration/backend/.env).");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, loadAbi(), provider);
  return { provider, contract };
}

async function onChainEntry(contract, logId) {
  try {
    const e = await contract.getLogEntry(logId);
    return {
      logHash: e[0],
      timestamp: e[1],
      verifiedAt: e[2],
      isTampered: e[3],
      recordedBy: e[4],
    };
  } catch (_) {
    return null;
  }
}

function parseManifest(text) {
  const entries = [];
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) return;
      const parts = line.split(/\s+/);
      if (parts.length < 2) {
        throw new Error('Manifest baris ' + (i + 1) + ': format harus "<logId> <path file log>" — dapat "' + line + '".');
      }
      entries.push({ logId: parts[0], file: parts.slice(1).join(" ") });
    });
  if (entries.length === 0) throw new Error("Manifest kosong: tidak ada entri aktif (semua baris kosong/komentar).");

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.logId)) throw new Error("logId duplikat di manifest: " + e.logId);
    seen.add(e.logId);
  }
  return entries;
}

function prepareBatchEntries(mode, entries) {
  const ok = [];
  const bad = [];
  for (const e of entries) {
    let info;
    try {
      info = hashForMode(mode, e.file);
    } catch (err) {
      bad.push({ ...e, reason: "gagal membaca file: " + (err.message || err) });
      continue;
    }
    if (info.missing) bad.push({ ...e, reason: "file log tidak ada" });
    else if (info.empty) bad.push({ ...e, reason: "file ada tapi 0 baris berisi (mode merkle)" });
    else ok.push({ ...e, hash: info.hash, detail: info.detail, lines: info.lines });
  }
  return { ok, bad };
}

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

async function onChainHashOf(contract, logId) {
  try {
    const status = await contract.getLogStatus(logId);
    const hash = status[0];
    return typeof hash === "string" && hash.length > 0 ? hash : null;
  } catch (_) {
    return null;
  }
}

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
  PROOFS_SUFFIX,
  PROOFS_FORMAT,
  die,
  short,
  printBanner,
  argNumber,
  sha256Hex,
  sha256File,
  readLogLines,
  merkleRootOfLines,
  leafHash,
  leafHashHex,
  merkleProofOfLine,
  verifyLineProof,
  proofsPathFor,
  slugLogId,
  buildProofArtifacts,
  saveProofArtifacts,
  loadProofArtifacts,
  hashForMode,
  loadAbi,
  connect,
  connectReadOnly,
  onChainEntry,
  parseManifest,
  prepareBatchEntries,
  explainError,
  explorerLink,
  roleNameSafe,
  onChainHashOf,
  detectModeMismatch,
};
