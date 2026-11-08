#!/usr/bin/env node
/**
 * collectorService.js — backend daemon: batch log -> on-chain, otomatis
 * ---------------------------------------------------------------------------
 * Ini "lem" antara server korban (#3) dan smart contract (#1):
 *
 *   log-shipper menulis batch + index.ndjson
 *        -> service ini merekam tiap batch baru (Merkle Root) ke kontrak
 *        -> lalu mengecek ulang integritasnya secara berkala (view, GRATIS)
 *        -> kalau berubah/hilang, kirim verifyLogIntegrity -> event
 *           TamperingDetected -> dashboard (#5) menyalakan alarm
 *
 * Tanpa service ini, `record`/`watch` harus dijalankan manual per file.
 *
 * ---------------------------------------------------------------------------
 * CARA PAKAI
 * ---------------------------------------------------------------------------
 *   node collectorService.js                 # daemon (scan 10s, verify 30s)
 *   node collectorService.js --once          # satu putaran lalu keluar (CI/uji)
 *   node collectorService.js --once --no-db  # paksa tanpa MongoDB
 *
 * ENV:
 *   BATCH_DIR          folder batch (default: <repo>/siem-batches)
 *   STATE_PATH         file state JSON (default: <BATCH_DIR>/.collector-state.json)
 *   SCAN_INTERVAL_MS   jeda scan batch baru (default 10000)
 *   VERIFY_INTERVAL_MS jeda verifikasi ulang (default 30000)
 *   VICTIM_HOST        awalan logId untuk file yang tidak ada di index
 *                      (default: nama host mesin ini)
 *   + RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY (lihat integration/backend/.env)
 *
 * Akun di PRIVATE_KEY harus ber-role SOC_ANALYST atau ADMIN.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const core = require("./lib/collector-core");
const queue = require("./lib/batch-queue");

const MODE = core.MODE_MERKLE;

const BATCH_DIR = process.env.BATCH_DIR || path.join(core.REPO_ROOT, "siem-batches");
const INDEX_PATH = path.join(BATCH_DIR, "index.ndjson");
const STATE_PATH = process.env.STATE_PATH || path.join(BATCH_DIR, ".collector-state.json");
const SCAN_MS = core.argNumber(process.env.SCAN_INTERVAL_MS, 10000);
const VERIFY_MS = core.argNumber(process.env.VERIFY_INTERVAL_MS, 30000);
const VICTIM_HOST = process.env.VICTIM_HOST || os.hostname();
const ONCE = process.argv.includes("--once");

const stamp = () => new Date().toLocaleTimeString("id-ID");

// ---------------------------------------------------------------------------
// State (file JSON kecil, bukan DB — MongoDB tetap opsional)
// ---------------------------------------------------------------------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) || {};
  } catch (err) {
    console.log(`[${stamp()}] ⚠️  state rusak (${err.message}) — mulai dari state kosong`);
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const tmp = STATE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    console.log(`[${stamp()}] ⚠️  gagal menyimpan state: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Kumpulkan kandidat batch: dari index.ndjson + file *.log yang belum terindeks
// ---------------------------------------------------------------------------
function collectCandidates() {
  const fromIndex = [];
  if (fs.existsSync(INDEX_PATH)) {
    const { entries, invalid } = queue.parseIndex(fs.readFileSync(INDEX_PATH, "utf8"));
    fromIndex.push(...entries);
    for (const bad of invalid) {
      console.log(`[${stamp()}] ⚠️  index.ndjson baris ${bad.line}: ${bad.reason} (dilewati)`);
    }
  } else {
    console.log(`[${stamp()}] ℹ️  ${INDEX_PATH} belum ada — pakai pemindaian folder`);
  }

  const known = new Set(fromIndex.map((e) => e.file));
  const extra = [];
  if (fs.existsSync(BATCH_DIR)) {
    for (const name of fs.readdirSync(BATCH_DIR)) {
      if (!name.endsWith(".log") || known.has(name)) continue;
      extra.push({ logId: `${VICTIM_HOST}/${path.basename(name, ".log")}`, file: name });
    }
  }
  return [...fromIndex, ...extra].map((e) => ({ ...e, file: path.isAbsolute(e.file) ? e.file : path.join(BATCH_DIR, e.file) }));
}

// ---------------------------------------------------------------------------
// Rekam batch yang belum ada on-chain
// ---------------------------------------------------------------------------
async function recordPending(contract, wallet, state, candidates) {
  const pending = queue.pendingRecords(candidates, state).filter((e) => {
    if (fs.existsSync(e.file)) return true;
    console.log(`[${stamp()}] ⚠️  ${e.logId}: file ${path.basename(e.file)} tidak ada — dilewati`);
    return false;
  });
  if (pending.length === 0) return 0;

  // Siapkan hash + bukti per baris; file yang kosong dilewati (mode Merkle tidak
  // punya daun untuk dibangun).
  const siap = [];
  for (const e of pending) {
    const info = core.hashForMode(MODE, e.file);
    if (info.empty) {
      console.log(`[${stamp()}] ⚠️  ${e.logId}: file ada tapi 0 baris — dilewati`);
      continue;
    }
    const artifacts = core.buildProofArtifacts(info.lines, e.logId, info.hash);
    const rusak = artifacts.lines.filter((l) => !core.verifyLineProof(l.content, l.proof, artifacts.merkleRoot)).length;
    if (rusak > 0) {
      console.log(`[${stamp()}] ⚠️  ${e.logId}: ${rusak} bukti baris gagal diverifikasi — dilewati`);
      continue;
    }
    core.saveProofArtifacts(e.file, artifacts);
    siap.push({ ...e, hash: artifacts.merkleRoot, lines: artifacts.lineCount });
  }
  if (siap.length === 0) return 0;

  // Skrining gratis: logId yang sudah terdaftar (mis. service restart) tidak dikirim.
  const belumAda = [];
  for (const e of siap) {
    if (await core.onChainHashOf(contract, e.logId)) {
      state[e.logId] = queue.recordStateUpdate(state[e.logId], { file: e.file, root: "0x", nowMs: Date.now() });
      continue;
    }
    belumAda.push(e);
  }
  if (belumAda.length === 0) {
    saveState(state);
    return 0;
  }

  try {
    let gas = 0n;
    if (belumAda.length === 1) {
      const tx = await contract.recordLogHash(belumAda[0].logId, belumAda[0].hash);
      const rc = await tx.wait();
      gas = rc.gasUsed;
    } else {
      const tx = await contract.recordLogHashBatch(
        belumAda.map((e) => e.logId),
        belumAda.map((e) => e.hash)
      );
      const rc = await tx.wait();
      gas = rc.gasUsed;
    }
    const now = Date.now();
    for (const e of belumAda) {
      state[e.logId] = queue.recordStateUpdate(state[e.logId], { file: e.file, root: e.hash, nowMs: now });
      console.log(`[${stamp()}] ✅ rekam ${e.logId} (${e.lines} baris) ${core.short(e.hash)}`);
    }
    console.log(
      `[${stamp()}]    ${belumAda.length} batch dalam 1 transaksi, gas ${gas.toString()} (${(gas / BigInt(belumAda.length)).toString()}/batch)`
    );
    saveState(state);
    return belumAda.length;
  } catch (err) {
    console.log(`[${stamp()}] ❌ gagal merekam: ${core.explainError(contract, err)}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Verifikasi berkala (view gratis; transaksi hanya kalau benar-benar berbeda)
// ---------------------------------------------------------------------------
async function verifyDue(contract, state) {
  const due = queue.dueVerifications(state, Date.now(), VERIFY_MS);
  let alarms = 0;
  for (const item of due) {
    const info = core.hashForMode(MODE, item.file);
    let isMatch;
    try {
      isMatch = await contract.verifyLogIntegrityView(item.logId, info.hash);
    } catch (err) {
      console.log(`[${stamp()}] ❌ ${item.logId}: ${core.explainError(contract, err)}`);
      continue;
    }

    if (isMatch) {
      state[item.logId] = queue.verifyStateUpdate(state[item.logId], { isMatch: true, nowMs: Date.now() });
      continue;
    }

    // Bukan tampering, cuma logId ini direkam mode lain (hash file utuh)?
    const mismatch = await core.detectModeMismatch(contract, item.logId, item.file, MODE);
    if (mismatch) {
      console.log(`[${stamp()}] ⚠️  ${item.logId}: direkam dengan mode "${mismatch.otherMode}" — alarm ditahan`);
      state[item.logId] = queue.verifyStateUpdate(state[item.logId], { isMatch: true, nowMs: Date.now() });
      continue;
    }

    // Benar-benar berbeda: kirim transaksi supaya alarm tercatat on-chain.
    try {
      const tx = await contract.verifyLogIntegrity(item.logId, info.hash);
      const rc = await tx.wait();
      for (const log of rc.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === "TamperingDetected") {
            console.log(`[${stamp()}] 🔴 TAMPERED ${parsed.args[0]}`);
            console.log(`             hash ASLI  : ${parsed.args[1]}`);
            console.log(`             hash SERVER: ${parsed.args[2]}`);
          }
        } catch (_) {
          /* log kontrak lain */
        }
      }
      state[item.logId] = queue.verifyStateUpdate(state[item.logId], { isMatch: false, nowMs: Date.now() });
      alarms++;
      console.log(`[${stamp()}]    alarm tercatat on-chain (gas ${rc.gasUsed.toString()})`);
      const link = core.explorerLink(tx.hash);
      if (link) console.log(`             ${link}`);
    } catch (err) {
      console.log(`[${stamp()}] ❌ gagal kirim alarm ${item.logId}: ${core.explainError(contract, err)}`);
    }
  }
  if (alarms > 0) saveState(state);
  return alarms;
}

// ---------------------------------------------------------------------------
// Satu putaran
// ---------------------------------------------------------------------------
async function pass(contract, wallet, state) {
  const candidates = collectCandidates();
  const recorded = await recordPending(contract, wallet, state, candidates);
  const alarms = await verifyDue(contract, state);
  const ringkas = queue.summarize(state);
  console.log(
    `[${stamp()}] putaran: ${candidates.length} batch terlihat, ${recorded} direkam, ${alarms} alarm · total ${ringkas.total} terdaftar${ringkas.tampered ? `, ${ringkas.tampered} tampered` : ""}`
  );
  return { recorded, alarms, ringkas };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(BATCH_DIR)) core.die("Folder BATCH_DIR tidak ada: " + BATCH_DIR);
  const { provider, wallet, contract } = await core.connect();
  const net = await provider.getNetwork();
  const state = loadState();

  core.printBanner("MODE     : collectorService (batch -> on-chain, otomatis)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["Batch dir", BATCH_DIR],
    ["State", STATE_PATH],
    ["Interval", "scan " + SCAN_MS + "ms · verify " + VERIFY_MS + "ms"],
    ["Mode", ONCE ? "sekali jalan (--once)" : "daemon"],
  ]);

  if (ONCE) {
    await pass(contract, wallet, state);
    return;
  }

  let timer = null;
  const loop = async () => {
    try {
      await pass(contract, wallet, state);
    } catch (err) {
      console.log(`[${stamp()}] ❌ putaran gagal: ${err.message || err}`);
    }
  };
  await loop();
  timer = setInterval(loop, SCAN_MS);

  const stop = () => {
    if (timer) clearInterval(timer);
    saveState(state);
    console.log("\nBerhenti. State disimpan di " + STATE_PATH);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => core.die(e.message || String(e)));
