#!/usr/bin/env node
/**
 * logCollector.js — Backend Log Collector (kit integrasi untuk Yasin)
 * ------------------------------------------------------------------
 * Membaca file log di server, menghitung SHA-256-nya, lalu berbicara dengan
 * smart contract SIEMLogger:
 *
 *   record  : mendaftarkan hash log untuk PERTAMA kali (dikunci on-chain)
 *   watch   : loop — hitung ulang hash, bandingkan dengan on-chain,
 *             dan kalau BEDA -> kirim transaksi verifyLogIntegrity supaya
 *             kontrak memancarkan event `TamperingDetected` (alarm on-chain)
 *             yang didengarkan oleh dashboard Joseph.
 *
 * Optimasi gas: pengecekan rutin memakai `verifyLogIntegrityView` (view,
 * GRATIS, tidak menulis state). Transaksi berbayar hanya dikirim kalau
 * memang terdeteksi tidak cocok.
 *
 * ---------------------------------------------------------------------------
 * CARA PAKAI
 * ---------------------------------------------------------------------------
 *   node logCollector.js record <fileLog> <logId>
 *   node logCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]
 *
 * Contoh:
 *   node logCollector.js record ./sample/auth.log "auth.log#2026-10-09"
 *   node logCollector.js watch  ./sample/auth.log "auth.log#2026-10-09" 5
 *
 * ---------------------------------------------------------------------------
 * ENV YANG DIBUTUHKAN
 * ---------------------------------------------------------------------------
 *   RPC_URL            endpoint testnet, mis. https://rpc.sepolia.org
 *   CONTRACT_ADDRESS   alamat hasil deploy (lihat deployments.json)
 *   PRIVATE_KEY        private key akun yang SUDAH diberi role
 *                      SOC_ANALYST atau ADMIN  (jangan commit file .env!)
 *   ABI_PATH           opsional, default ../../contracts/SIEMLogger.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

// ---------------------------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------------------------
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ABI_PATH =
  process.env.ABI_PATH ||
  path.resolve(__dirname, "../../contracts/SIEMLogger.json");

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

/** SHA-256 isi file log, dikembalikan sebagai hex string 0x + 64 char. */
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) die("File log tidak ditemukan: " + filePath);
  const buf = fs.readFileSync(filePath);
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

/** Penanda kalau file log sudah tidak ada lagi (dihapus penyerang). */
const HASH_FILE_MISSING = "0x__LOG_FILE_MISSING__";

/**
 * Hash file log saat ini. Kalau file-nya HILANG, kembalikan penanda khusus
 * alih-alih crash — supaya penghapusan file tetap terdeteksi sebagai
 * tampering (justru ini serangan yang paling sering dipakai: buang jejaknya).
 */
function currentHashOf(filePath) {
  if (!fs.existsSync(filePath)) return HASH_FILE_MISSING;
  return sha256File(filePath);
}

function short(h) {
  return typeof h === "string" && h.length > 18 ? h.slice(0, 10) + "…" + h.slice(-6) : String(h);
}

function explorerLink(hash) {
  if (RPC_URL.includes("sepolia")) return "https://sepolia.etherscan.io/tx/" + hash;
  if (RPC_URL.includes("amoy")) return "https://amoy.polygonscan.com/tx/" + hash;
  return null;
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

async function connect() {
  if (!CONTRACT_ADDRESS) die("ENV CONTRACT_ADDRESS belum di-set.");
  if (!PRIVATE_KEY) die("ENV PRIVATE_KEY belum di-set.");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, loadAbi(), wallet);
  return { provider, wallet, contract };
}

// ---------------------------------------------------------------------------
// Mode: record
// ---------------------------------------------------------------------------
async function cmdRecord(logFile, logId) {
  const { provider, wallet, contract } = await connect();
  const hash = sha256File(logFile);
  const net = await provider.getNetwork();

  console.log("─".repeat(70));
  console.log("MODE     : record");
  console.log("Kontrak  :", CONTRACT_ADDRESS);
  console.log("Chain    :", net.chainId.toString());
  console.log("Akun     :", wallet.address, "| role:", await roleNameSafe(contract, wallet.address));
  console.log("File log :", logFile);
  console.log("logId    :", logId);
  console.log("SHA-256  :", hash);
  console.log("─".repeat(70));

  try {
    const tx = await contract.recordLogHash(logId, hash);
    console.log("⏳ transaksi terkirim:", tx.hash);
    const rc = await tx.wait();
    console.log("✅ hash terkunci on-chain. gas:", rc.gasUsed.toString());
    const link = explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    die(explainError(contract, err));
  }
}

// ---------------------------------------------------------------------------
// Mode: watch
// ---------------------------------------------------------------------------
async function cmdWatch(logFile, logId, intervalSec, maxIter) {
  const { provider, wallet, contract } = await connect();
  await provider.getNetwork();

  console.log("─".repeat(70));
  console.log("MODE     : watch  (interval " + intervalSec + "s)");
  console.log("Kontrak  :", CONTRACT_ADDRESS);
  console.log("Akun     :", wallet.address, "| role:", await roleNameSafe(contract, wallet.address));
  console.log("File log :", logFile);
  console.log("logId    :", logId);
  console.log("─".repeat(70));

  let iteration = 0;
  let tamperCount = 0;

  const tick = async () => {
    iteration++;
    const currentHash = currentHashOf(logFile);
    const fileMissing = currentHash === HASH_FILE_MISSING;

    // 1) Cek GRATIS dulu (view, tidak menulis state, tidak butuh gas)
    let isMatch;
    try {
      isMatch = await contract.verifyLogIntegrityView(logId, currentHash);
    } catch (err) {
      die(explainError(contract, err));
    }

    const stamp = new Date().toLocaleTimeString("id-ID");

    if (isMatch) {
      console.log(`[${stamp}] #${iteration} 🟢 AMAN     hash cocok (${short(currentHash)})`);
      return;
    }

    // 2) TIDAK cocok -> kirim transaksi supaya alarm tercatat on-chain
    tamperCount++;
    if (fileMissing) {
      console.log(`[${stamp}] #${iteration} 🔴 FILE LOG HILANG! ${logFile} sudah tidak ada di server`);
      console.log("            → penghapusan log = tampering. Mengirim transaksi verifyLogIntegrity…");
    } else {
      console.log(`[${stamp}] #${iteration} 🔴 TAMPERED! hash server ${short(currentHash)} ≠ hash on-chain`);
      console.log("            → mengirim transaksi verifyLogIntegrity untuk memicu event TamperingDetected…");
    }
    try {
      const tx = await contract.verifyLogIntegrity(logId, currentHash);
      const rc = await tx.wait();

      // baca event dari receipt
      for (const log of rc.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === "TamperingDetected") {
            console.log("            ⚠️  event TamperingDetected dipancarkan:");
            console.log("                logId       :", parsed.args[0]);
            console.log("                hash ASLI   :", parsed.args[1]);
            console.log("                hash SERVER :", parsed.args[2]);
          }
        } catch (_) {
          /* log dari kontrak lain, abaikan */
        }
      }
      console.log("            ✅ alarm tercatat on-chain (gas " + rc.gasUsed.toString() + ")");
      const link = explorerLink(tx.hash);
      if (link) console.log("               " + link);
      console.log("            → dashboard SOC (Joseph) sekarang menerima event ini secara real-time.");
    } catch (err) {
      console.error("            ❌ gagal mengirim transaksi:", explainError(contract, err));
    }
  };

  await tick();
  if (maxIter && iteration >= maxIter) {
    console.log("─".repeat(70));
    console.log(`Selesai. ${iteration} iterasi, ${tamperCount} alarm.`);
    return;
  }

  const timer = setInterval(async () => {
    await tick();
    if (maxIter && iteration >= maxIter) {
      clearInterval(timer);
      console.log("─".repeat(70));
      console.log(`Selesai. ${iteration} iterasi, ${tamperCount} alarm.`);
      process.exit(0);
    }
  }, intervalSec * 1000);
}

async function roleNameSafe(contract, addr) {
  try {
    return await contract.getRoleName(addr);
  } catch (_) {
    return "(tidak bisa dibaca)";
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const [mode, logFile, logId, arg4, arg5] = process.argv.slice(2);

  if (mode === "record") {
    if (!logFile || !logId) die("Pakai: node logCollector.js record <fileLog> <logId>");
    await cmdRecord(logFile, logId);
  } else if (mode === "watch") {
    if (!logFile || !logId) die("Pakai: node logCollector.js watch <fileLog> <logId> [intervalDetik] [maxIterasi]");
    await cmdWatch(logFile, logId, Number(arg4) || 5, arg5 ? Number(arg5) : 0);
  } else {
    console.log(`
logCollector.js — Backend Log Collector (Tamper-Proof SIEM dApp)

  node logCollector.js record <fileLog> <logId>
  node logCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]

Env: RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY [, ABI_PATH]
`);
  }
}

main().catch((e) => die(e.message || String(e)));
