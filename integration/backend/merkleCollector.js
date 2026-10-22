#!/usr/bin/env node
/**
 * merkleCollector.js — Backend Log Collector (mode: Merkle Tree)
 * ------------------------------------------------------------------
 * File log dipecah baris demi baris, tiap baris di-hash SHA-256 sebagai leaf,
 * lalu **Merkle Root**-nya dikunci on-chain (nilai yang dikirim sebagai
 * `logHash`). Baris mentahnya boleh disimpan di MongoDB supaya bisa
 * ditunjukkan **baris mana** yang berubah.
 *
 * MongoDB OPSIONAL. Kalau MONGO_URI kosong (default di .env.example) atau
 * dijalankan dengan flag `--no-db`, skrip tetap jalan: yang hilang hanya
 * penyimpanan off-chain + perbandingan baris demi baris.
 *
 * ---------------------------------------------------------------------------
 * CARA PAKAI
 * ---------------------------------------------------------------------------
 *   node merkleCollector.js record <fileLog> <logId>
 *   node merkleCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]
 *
 * [intervalDetik] default 5 · [maxIterasi] default 0 (jalan terus).
 * Tambahkan `--no-db` untuk memaksa tanpa MongoDB.
 *
 * ---------------------------------------------------------------------------
 * CATATAN PENTING
 * ---------------------------------------------------------------------------
 * Nilai yang dikirim sebagai `logHash` BERBEDA dengan logCollector.js
 * (Merkle Root vs SHA-256 file utuh). Satu `logId` hanya boleh dikelola satu
 * skrip — kalau tertukar, skrip ini akan melaporkan "SALAH SKRIP" dan tidak
 * mengirim alarm palsu (lihat core.detectModeMismatch).
 */

const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const core = require("./lib/collector-core");

const MODE = core.MODE_MERKLE;
const MONGO_URI = core.MONGO_URI;
const USE_DB = MONGO_URI !== "" && !process.argv.includes("--no-db");

// ---------------------------------------------------------------------------
// Skema MongoDB (hanya dipakai kalau USE_DB)
// ---------------------------------------------------------------------------
const logSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  merkleRoot: { type: String, required: true },
  lines: [
    {
      index: Number,
      content: String,
      hash: String,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});
const LogModel = mongoose.model("LogBatch", logSchema);

async function connectMongo() {
  if (!USE_DB) return false;
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Terhubung ke MongoDB:", MONGO_URI);
    return true;
  } catch (err) {
    core.die(
      "Gagal koneksi ke MongoDB: " + err.message +
        "\n   Pakai flag --no-db (atau kosongkan MONGO_URI di .env) untuk jalan tanpa DB."
    );
  }
}

async function closeMongo() {
  if (USE_DB) await mongoose.disconnect();
}

const dbLabel = () => (USE_DB ? "aktif (" + MONGO_URI + ")" : "nonaktif — tanpa penyimpanan off-chain / diff per baris");

// ---------------------------------------------------------------------------
// Mode: record
// ---------------------------------------------------------------------------
async function cmdRecord(logFile, logId) {
  const { provider, wallet, contract } = await core.connect();
  const info = core.hashForMode(MODE, logFile);
  const net = await provider.getNetwork();

  if (info.missing) core.die("File log tidak ditemukan: " + logFile);
  if (info.empty) {
    core.die(
      "File log ada tapi tidak punya baris berisi (0 baris) — tidak ada yang bisa dijadikan Merkle Tree: " + logFile
    );
  }

  core.printBanner("MODE     : record  (logHash = Merkle Root)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["File log", logFile],
    ["logId", logId],
    ["Total baris", info.lines.length],
    ["Merkle Root", info.hash],
    ["MongoDB", dbLabel()],
  ]);

  if (USE_DB) {
    try {
      const existing = await LogModel.findOne({ logId });
      if (existing) core.die(`Log ID ${logId} sudah tersimpan di database. Pakai logId baru.`);
      await LogModel.create({
        logId,
        merkleRoot: info.hash,
        lines: info.lines.map((content, index) => ({
          index,
          content,
          hash: "0x" + require("crypto").createHash("sha256").update(content).digest("hex"),
        })),
      });
      console.log("✅ Baris log mentah tersimpan di MongoDB.");
    } catch (err) {
      core.die("Error MongoDB: " + err.message);
    }
  } else {
    console.log("ℹ️  Tanpa MongoDB: baris log tidak disimpan off-chain (diff per baris tidak akan tersedia).");
  }

  try {
    const tx = await contract.recordLogHash(logId, info.hash);
    console.log("⏳ transaksi terkirim:", tx.hash);
    const rc = await tx.wait();
    console.log("✅ Merkle Root terkunci on-chain. gas:", rc.gasUsed.toString());
    const link = core.explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    console.error("❌ Transaksi gagal:", core.explainError(contract, err));
    await closeMongo();
    process.exitCode = 1;
    return;
  }

  await closeMongo();
}

/** Tampilkan baris mana yang DIUBAH/DITAMBAH/DIHAPUS, dari salinan di MongoDB. */
async function printLineDiff(logId, lines) {
  if (!USE_DB) {
    console.log("   (laporan per baris butuh MongoDB — jalankan dengan MONGO_URI terisi)");
    return;
  }
  const dbLog = await LogModel.findOne({ logId });
  if (!dbLog) {
    console.log("   (tidak ada salinan baris di MongoDB untuk logId ini)");
    return;
  }
  const orig = dbLog.lines || [];
  const max = Math.max(lines.length, orig.length);
  let shown = 0;
  for (let i = 0; i < max; i++) {
    const before = orig[i];
    const now = lines[i];
    if (!before) {
      console.log(`   [TAMBAHAN] baris ke-${i}: ${now}`);
      shown++;
    } else if (!now) {
      console.log(`   [DIHAPUS ] baris ke-${i}: ${before.content}`);
      shown++;
    } else if (before.content !== now) {
      console.log(`   [DIUBAH  ] baris ke-${i}:`);
      console.log(`        asli : ${before.content}`);
      console.log(`        baru : ${now}`);
      shown++;
    }
  }
  if (shown === 0) console.log("   (tidak ada baris yang berbeda dari salinan MongoDB)");
}

// ---------------------------------------------------------------------------
// Mode: watch
// ---------------------------------------------------------------------------
async function cmdWatch(logFile, logId, intervalSec, maxIter) {
  const { provider, wallet, contract } = await core.connect();
  await provider.getNetwork();
  await connectMongo();

  core.printBanner(
    "MODE     : watch   (logHash = Merkle Root, interval " + intervalSec + "s)",
    [
      ["Kontrak", core.CONTRACT_ADDRESS],
      ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
      ["File log", logFile],
      ["logId", logId],
      ["MongoDB", dbLabel()],
    ]
  );

  let iteration = 0;
  let tamperCount = 0;

  const tick = async () => {
    iteration++;
    const info = core.hashForMode(MODE, logFile);
    const stamp = new Date().toLocaleTimeString("id-ID");

    // File hilang / tanpa baris: langsung dianggap tampering (truncate log =
    // alat paling umum untuk menghapus jejak). Tidak perlu tanya kontrak.
    if (info.missing || info.empty) {
      tamperCount++;
      if (info.missing) {
        console.log(`[${stamp}] #${iteration} 🔴 FILE LOG HILANG! ${logFile} tidak ada di server`);
      } else {
        console.log(`[${stamp}] #${iteration} 🔴 FILE LOG KOSONG! ${logFile} ada tapi 0 baris berisi`);
      }
      console.log(`            → mengirim ${info.hash} sebagai bukti dan memicu alarm on-chain…`);
      return sendAlarm(info.hash);
    }

    // Cek GRATIS dulu (view, 0 gas)
    let isMatch;
    try {
      isMatch = await contract.verifyLogIntegrityView(logId, info.hash);
    } catch (err) {
      core.die(core.explainError(contract, err));
    }

    if (isMatch) {
      console.log(`[${stamp}] #${iteration} 🟢 AMAN     Merkle Root cocok (${core.short(info.hash)})`);
      return;
    }

    // Bukan tampering, tapi logId ini dikelola skrip mode lain?
    const mismatch = await core.detectModeMismatch(contract, logId, logFile, MODE);
    if (mismatch) {
      console.log(`[${stamp}] #${iteration} ⚠️  SALAH SKRIP — logId ini direkam dengan mode "${mismatch.otherMode}"`);
      console.log("            hash on-chain cocok dengan hasil hitung mode itu, jadi isi file TIDAK berubah.");
      console.log("            Alarm tidak dikirim. Pakai skrip logCollector.js untuk logId ini.");
      return;
    }

    tamperCount++;
    console.log(`[${stamp}] #${iteration} 🔴 TAMPERED! Merkle Root server ${core.short(info.hash)} ≠ on-chain`);
    console.log("   🔍 Membandingkan baris log dengan salinan off-chain…");
    await printLineDiff(logId, info.lines);
    await sendAlarm(info.hash);
  };

  const sendAlarm = async (hash) => {
    try {
      const tx = await contract.verifyLogIntegrity(logId, hash);
      const rc = await tx.wait();
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
      const link = core.explorerLink(tx.hash);
      if (link) console.log("               " + link);
      console.log("            → dashboard SOC (Joseph) menerima event ini real-time.");
    } catch (err) {
      console.error("            ❌ gagal mengirim transaksi:", core.explainError(contract, err));
    }
  };

  const finish = async () => {
    console.log("─".repeat(70));
    console.log(`Selesai. ${iteration} iterasi, ${tamperCount} alarm.`);
    await closeMongo();
  };

  await tick();
  if (maxIter > 0 && iteration >= maxIter) return finish();

  const timer = setInterval(async () => {
    await tick();
    if (maxIter > 0 && iteration >= maxIter) {
      clearInterval(timer);
      await finish();
      process.exit(0);
    }
  }, intervalSec * 1000);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  // buang flag (mis. --no-db) supaya posisi argumen tetap
  const [mode, logFile, logId, intervalArg, maxIterArg] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));

  if (mode === "record") {
    if (!logFile || !logId) core.die("Pakai: node merkleCollector.js record <fileLog> <logId>");
    await cmdRecord(logFile, logId);
  } else if (mode === "watch") {
    if (!logFile || !logId) {
      core.die("Pakai: node merkleCollector.js watch <fileLog> <logId> [intervalDetik] [maxIterasi] [--no-db]");
    }
    await cmdWatch(logFile, logId, core.argNumber(intervalArg, 5), core.argNumber(maxIterArg, 0));
  } else {
    console.log(`
merkleCollector.js — Backend Log Collector (logHash = Merkle Root)

  node merkleCollector.js record <fileLog> <logId>
  node merkleCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi] [--no-db]

  [intervalDetik] default 5 · [maxIterasi] default 0 (jalan terus)
  --no-db        : paksa jalan tanpa MongoDB (diff per baris tidak tersedia)
Env: RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY [, ABI_PATH, MONGO_URI]
      — atau isi integration/backend/.env
`);
  }
}

main().catch((e) => core.die(e.message || String(e)));
