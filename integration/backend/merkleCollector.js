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
 *   node merkleCollector.js prove  <fileLog> <logId> [indexBaris]
 *   node merkleCollector.js batch  <manifest.txt>
 *
 * `record` menyimpan Merkle Root on-chain PLUS bukti per baris
 * (`<fileLog>.<logId>.proofs.json`). `prove` membuktikan baris ke-i masih
 * identik dengan yang direkam — verifikasi Merkle proof terhadap Merkle Root
 * on-chain, hanya-baca (tanpa PRIVATE_KEY). `batch` = banyak logId dalam satu
 * transaksi (recordLogHashBatch).
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
  algorithm: { type: Object, default: { hash: "sha256", leaf: "sha256(isi baris)", sortPairs: true } },
  lines: [
    {
      index: Number,
      content: String,
      hash: String,
      // Jalur sibling hash untuk baris ini (Merkle proof). Bukti ini bisa
      // diverifikasi ulang terhadap Merkle Root ON-CHAIN tanpa mempercayai DB.
      proof: [String],
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

/**
 * Versi "jangan mati" untuk mode hanya-baca (`prove`): kalau Mongo tidak bisa
 * dipakai, verifikasi tetap lanjut memakai file bukti `<fileLog>.proofs.json`.
 */
async function tryFindInMongo(logId) {
  if (!USE_DB) return null;
  try {
    await mongoose.connect(MONGO_URI);
    return await LogModel.findOne({ logId });
  } catch (err) {
    console.log("ℹ️  MongoDB tidak bisa dipakai (" + err.message + ") — lanjut dengan file bukti.");
    return null;
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

  // Bukti per baris dibangun dari file yang MASIH ASLI, lalu diverifikasi ulang
  // satu per satu terhadap root-nya sendiri sebelum apa pun dikirim ke jaringan.
  const artifacts = core.buildProofArtifacts(info.lines, logId, info.hash);
  const broken = artifacts.lines.filter((l) => !core.verifyLineProof(l.content, l.proof, artifacts.merkleRoot));
  if (broken.length > 0) {
    core.die(
      broken.length + " dari " + artifacts.lineCount + " bukti baris gagal diverifikasi ulang terhadap Merkle Root — pembuatan pohon tidak konsisten, tidak ada yang dikirim on-chain."
    );
  }
  const sidecar = core.saveProofArtifacts(logFile, artifacts);
  console.log("✅ Bukti Merkle per baris disimpan: " + sidecar + " (" + artifacts.lineCount + " baris, " + broken.length + " gagal-verifikasi)");

  if (USE_DB) {
    try {
      const existing = await LogModel.findOne({ logId });
      if (existing) core.die(`Log ID ${logId} sudah tersimpan di database. Pakai logId baru.`);
      await LogModel.create({
        logId,
        merkleRoot: artifacts.merkleRoot,
        algorithm: artifacts.algorithm,
        lines: artifacts.lines.map((l) => ({ index: l.index, content: l.content, hash: l.hash, proof: l.proof })),
      });
      console.log("✅ Baris log + bukti Merkle tersimpan di MongoDB.");
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
// Mode: prove — bukti kriptografis per baris terhadap Merkle Root ON-CHAIN
// ---------------------------------------------------------------------------
/**
 * Menjawab pertanyaan: "benarkah baris ke-i file ini persis seperti yang direkam
 * saat itu?" — dengan Merkle proof, bukan dengan membandingkan teks ke salinan
 * DB yang bisa ditulis ulang penyerang.
 *
 * TIDAK butuh private key (hanya-baca): auditor pun bisa menjalankannya.
 */
async function cmdProve(logFile, logId, indexArg) {
  const { provider, contract } = await core.connectReadOnly();
  const net = await provider.getNetwork();

  const entry = await core.onChainEntry(contract, logId);
  if (!entry) {
    core.die(`logId "${logId}" belum terdaftar on-chain (LogNotFound). Jalankan mode record dulu.`);
  }
  const onChainRoot = entry.logHash;

  // Sumber bukti: Mongo (kalau bisa) -> file `<fileLog>.proofs.json`.
  const dbDoc = await tryFindInMongo(logId);
  const artifacts = core.loadProofArtifacts(logFile, logId, dbDoc);
  if (!artifacts) {
    core.die(
      "Tidak ada bukti tersimpan untuk logId ini.\n" +
        "   Dicari di: MongoDB (koleksi logbatches) dan " + core.proofsPathFor(logFile, logId) + "\n" +
        "   Bukti hanya bisa dibuat saat file log masih asli — jalankan `record` pada file yang belum diubah."
    );
  }
  const sinkron = String(artifacts.merkleRoot).toLowerCase() === String(onChainRoot).toLowerCase();

  core.printBanner("MODE     : prove   (Merkle proof per baris, hanya-baca)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["logId", logId],
    ["Root on-chain", onChainRoot],
    ["Sumber bukti", String(artifacts.source)],
    ["Baris di artefak", String(artifacts.lineCount)],
    ["isTampered", entry.isTampered ? "true 🔴" : "false 🟢"],
  ]);

  if (!sinkron) {
    console.log("⚠️  Merkle Root di artefak (" + core.short(artifacts.merkleRoot) + ") ≠ root on-chain.");
    console.log("    Artefak ini BUKAN set baris yang direkam on-chain — hasil di bawah tidak bisa dipakai sebagai bukti.");
    console.log("    (Bisa jadi file log sudah di-record ulang dengan logId/root berbeda.)\n");
  }

  const linesNow = core.readLogLines(logFile); // null kalau file hilang
  const wanted = indexArg === undefined || indexArg === "" ? artifacts.lines.map((l) => l.index) : [Number(indexArg)];
  if (wanted.some((i) => !Number.isInteger(i) || i < 0)) core.die("Index baris harus angka >= 0.");

  let proven = 0;
  let failed = 0;
  console.log("Per baris (leaf = sha256(isi baris), verifikasi dgn proof → root on-chain):");
  for (const idx of wanted) {
    const rec = artifacts.lines.find((l) => l.index === idx);
    if (!rec) {
      console.log(`  ⚠️  baris ke-${idx}: tidak ada di artefak bukti (di luar ${artifacts.lineCount} baris yang direkam)`);
      continue;
    }
    if (!linesNow) {
      failed++;
      console.log(`  🔴 baris ke-${idx}: TIDAK TERBUKTI — file log ${logFile} sudah tidak ada di server`);
      continue;
    }
    const now = linesNow[idx];
    if (now === undefined) {
      failed++;
      console.log(`  🔴 baris ke-${idx}: TIDAK TERBUKTI — baris sudah tidak ada (file dipotong/dihapus)`);
      console.log(`        asli : ${rec.content}`);
      continue;
    }
    if (core.verifyLineProof(now, rec.proof, onChainRoot)) {
      proven++;
      console.log(`  ✅ baris ke-${idx}: TERBUKTI identik (${rec.proof.length} sibling hash, root cocok)`);
    } else {
      failed++;
      console.log(`  🔴 baris ke-${idx}: TIDAK TERBUKTI — isi baris berubah (proof tidak menghasilkan root on-chain)`);
      console.log(`        asli : ${rec.content}`);
      console.log(`        baru : ${now}`);
    }
  }

  console.log("─".repeat(70));
  console.log(`Hasil: ${proven} baris TERBUKTI tidak berubah, ${failed} baris gagal dibuktikan.`);
  if (failed === 0 && proven > 0) {
    console.log("Semua baris yang diperiksa identik dengan yang tersegel di Merkle Root on-chain.");
  } else if (failed > 0) {
    console.log("Baris yang gagal = baris yang isinya berbeda dari yang direkam (bukti kriptografis, bukan tebakan).");
    process.exitCode = 1;
  }
  await closeMongo();
}

// ---------------------------------------------------------------------------
// Mode: batch — banyak logId dalam SATU transaksi (recordLogHashBatch)
// ---------------------------------------------------------------------------
async function cmdBatch(manifestPath) {
  if (!fs.existsSync(manifestPath)) core.die("Manifest tidak ditemukan: " + manifestPath);
  const entries = core.parseManifest(fs.readFileSync(manifestPath, "utf8"));

  const { provider, wallet, contract } = await core.connect();
  const net = await provider.getNetwork();

  const { ok, bad } = core.prepareBatchEntries(MODE, entries);

  // Skrining GRATIS (view): logId yang sudah terdaftar tidak boleh ikut dikirim —
  // kontrak memakai revert all-or-nothing, satu logId lama menggagalkan semua.
  const sudahAda = [];
  const akanKirim = [];
  for (const e of ok) {
    if (await core.onChainHashOf(contract, e.logId)) sudahAda.push(e);
    else akanKirim.push(e);
  }

  core.printBanner("MODE     : batch   (logHash = Merkle Root, 1 transaksi untuk banyak log)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["Manifest", manifestPath],
    ["Entri aktif", String(entries.length)],
    ["Akan dikirim", String(akanKirim.length)],
    ["MongoDB", dbLabel()],
  ]);

  for (const e of akanKirim) console.log("  • " + e.logId + "  " + e.detail + "  " + core.short(e.hash));
  for (const e of sudahAda) console.log("  ⏭️  DILEWATI (sudah terdaftar on-chain): " + e.logId);
  for (const e of bad) console.log("  ⚠️  DILEWATI (" + e.reason + "): " + e.logId + " → " + e.file);

  if (akanKirim.length === 0) {
    console.log("Tidak ada entri yang perlu dikirim. Selesai.");
    await closeMongo();
    return;
  }

  // Artefak bukti disiapkan lebih dulu (dari file yang masih asli), lalu diverifikasi ulang.
  const artifactsList = akanKirim.map((e) => core.buildProofArtifacts(e.lines, e.logId, e.hash));
  for (const a of artifactsList) {
    const rusak = a.lines.filter((l) => !core.verifyLineProof(l.content, l.proof, a.merkleRoot)).length;
    if (rusak > 0) core.die("Bukti baris untuk " + a.logId + " gagal diverifikasi ulang — batch dibatalkan sebelum kirim.");
  }

  await connectMongo();
  for (const a of artifactsList) {
    const logFile = akanKirim.find((e) => e.logId === a.logId).file;
    const sidecar = core.saveProofArtifacts(logFile, a);
    console.log("✅ Bukti per baris: " + sidecar + " (" + a.lineCount + " baris)");
    if (USE_DB) {
      try {
        await LogModel.create({
          logId: a.logId,
          merkleRoot: a.merkleRoot,
          algorithm: a.algorithm,
          lines: a.lines.map((l) => ({ index: l.index, content: l.content, hash: l.hash, proof: l.proof })),
        });
      } catch (err) {
        core.die("Error MongoDB untuk " + a.logId + ": " + err.message);
      }
    }
  }

  try {
    const tx = await contract.recordLogHashBatch(
      akanKirim.map((e) => e.logId),
      akanKirim.map((e) => e.hash)
    );
    console.log("⏳ transaksi batch terkirim:", tx.hash);
    const rc = await tx.wait();
    const gas = BigInt(rc.gasUsed.toString());
    console.log("✅ " + akanKirim.length + " logId terkunci on-chain dalam 1 transaksi.");
    console.log("   gas total : " + gas.toString());
    console.log("   per log   : " + (gas / BigInt(akanKirim.length)).toString() + " gas");
    const link = core.explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    console.error("❌ Transaksi batch gagal:", core.explainError(contract, err));
    process.exitCode = 1;
  }

  await closeMongo();
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
  } else if (mode === "prove") {
    if (!logFile || !logId) {
      core.die("Pakai: node merkleCollector.js prove <fileLog> <logId> [indexBaris] [--no-db]");
    }
    await cmdProve(logFile, logId, intervalArg === undefined ? undefined : intervalArg);
  } else if (mode === "batch") {
    if (!logFile) core.die("Pakai: node merkleCollector.js batch <manifest.txt> [--no-db]");
    await cmdBatch(logFile);
  } else {
    console.log(`
merkleCollector.js — Backend Log Collector (logHash = Merkle Root)

  node merkleCollector.js record <fileLog> <logId>
  node merkleCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi] [--no-db]
  node merkleCollector.js prove  <fileLog> <logId> [indexBaris] [--no-db]
  node merkleCollector.js batch  <manifest.txt> [--no-db]

  [intervalDetik] default 5 · [maxIterasi] default 0 (jalan terus)
  record : simpan root + BUKTI Merkle per baris (<fileLog>.proofs.json, + MongoDB kalau aktif)
  prove  : buktikan baris ke-i masih identik dgn yang direkam — HANYA-BACA, tanpa private key
  batch  : banyak logId dalam satu transaksi (recordLogHashBatch)
  --no-db        : paksa jalan tanpa MongoDB (diff per baris tidak tersedia)

Manifest batch = file teks, satu entri per baris:  <logId> <path file log>
Env: RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY [, ABI_PATH, MONGO_URI]
      — atau isi integration/backend/.env
`);
  }
}

main().catch((e) => core.die(e.message || String(e)));
