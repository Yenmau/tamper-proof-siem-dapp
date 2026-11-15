#!/usr/bin/env node

const core = require("./lib/collector-core");

const MODE = core.MODE_FILE;

async function cmdRecord(logFile, logId) {
  const { provider, wallet, contract } = await core.connect();
  const info = core.hashForMode(MODE, logFile);
  const net = await provider.getNetwork();

  if (info.missing) core.die("File log tidak ditemukan: " + logFile);

  core.printBanner("MODE     : record  (logHash = SHA-256 seluruh file)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["File log", logFile],
    ["logId", logId],
    ["SHA-256", info.hash],
  ]);

  try {
    const tx = await contract.recordLogHash(logId, info.hash);
    console.log("⏳ transaksi terkirim:", tx.hash);
    const rc = await tx.wait();
    console.log("[OK] hash terkunci on-chain. gas:", rc.gasUsed.toString());
    const link = core.explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    core.die(core.explainError(contract, err));
  }
}

async function cmdWatch(logFile, logId, intervalSec, maxIter) {
  const { provider, wallet, contract } = await core.connect();
  await provider.getNetwork();

  core.printBanner("MODE     : watch   (logHash = SHA-256 seluruh file, interval " + intervalSec + "s)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["File log", logFile],
    ["logId", logId],
  ]);

  let iteration = 0;
  let tamperCount = 0;

  const tick = async () => {
    iteration++;
    const info = core.hashForMode(MODE, logFile);

    let isMatch;
    try {
      isMatch = await contract.verifyLogIntegrityView(logId, info.hash);
    } catch (err) {
      core.die(core.explainError(contract, err));
    }

    const stamp = new Date().toLocaleTimeString("id-ID");

    if (isMatch) {
      console.log(`[${stamp}] #${iteration} AMAN     hash cocok (${core.short(info.hash)})`);
      return;
    }

    const mismatch = await core.detectModeMismatch(contract, logId, logFile, MODE);
    if (mismatch) {
      console.log(`[${stamp}] #${iteration} [!] SALAH SKRIP — logId ini direkam dengan mode "${mismatch.otherMode}"`);
      console.log("            hash on-chain cocok dengan hasil hitung mode itu, jadi isi file TIDAK berubah.");
      console.log("            Alarm tidak dikirim. Pakai skrip merkleCollector.js untuk logId ini.");
      return;
    }

    tamperCount++;
    if (info.missing) {
      console.log(`[${stamp}] #${iteration} FILE LOG HILANG! ${logFile} sudah tidak ada di server`);
      console.log("            → penghapusan log = tampering. Mengirim transaksi verifyLogIntegrity…");
    } else {
      console.log(`[${stamp}] #${iteration} TAMPERED! hash server ${core.short(info.hash)} ≠ hash on-chain`);
      console.log("            → mengirim transaksi verifyLogIntegrity untuk memicu event TamperingDetected…");
    }
    try {
      const tx = await contract.verifyLogIntegrity(logId, info.hash);
      const rc = await tx.wait();

      for (const log of rc.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === "TamperingDetected") {
            console.log("            [!] event TamperingDetected dipancarkan:");
            console.log("                logId       :", parsed.args[0]);
            console.log("                hash ASLI   :", parsed.args[1]);
            console.log("                hash SERVER :", parsed.args[2]);
          }
        } catch (_) {
        }
      }
      console.log("            [OK] alarm tercatat on-chain (gas " + rc.gasUsed.toString() + ")");
      const link = core.explorerLink(tx.hash);
      if (link) console.log("               " + link);
      console.log("            → dashboard SOC (Joseph) sekarang menerima event ini secara real-time.");
    } catch (err) {
      console.error("            [GAGAL] gagal mengirim transaksi:", core.explainError(contract, err));
    }
  };

  const finish = () => {
    console.log("─".repeat(70));
    console.log(`Selesai. ${iteration} iterasi, ${tamperCount} alarm.`);
  };

  await tick();
  if (maxIter > 0 && iteration >= maxIter) return finish();

  const timer = setInterval(async () => {
    await tick();
    if (maxIter > 0 && iteration >= maxIter) {
      clearInterval(timer);
      finish();
      process.exit(0);
    }
  }, intervalSec * 1000);
}

async function cmdBatch(manifestPath) {
  const fs = require("fs");
  if (!fs.existsSync(manifestPath)) core.die("Manifest tidak ditemukan: " + manifestPath);
  const entries = core.parseManifest(fs.readFileSync(manifestPath, "utf8"));

  const { provider, wallet, contract } = await core.connect();
  const net = await provider.getNetwork();
  const { ok, bad } = core.prepareBatchEntries(MODE, entries);

  const sudahAda = [];
  const akanKirim = [];
  for (const e of ok) {
    if (await core.onChainHashOf(contract, e.logId)) sudahAda.push(e);
    else akanKirim.push(e);
  }

  core.printBanner("MODE     : batch   (logHash = SHA-256 seluruh file, 1 transaksi)", [
    ["Kontrak", core.CONTRACT_ADDRESS],
    ["Chain", net.chainId.toString()],
    ["Akun", wallet.address + " | role: " + (await core.roleNameSafe(contract, wallet.address))],
    ["Manifest", manifestPath],
    ["Entri aktif", String(entries.length)],
    ["Akan dikirim", String(akanKirim.length)],
  ]);

  for (const e of akanKirim) console.log("  • " + e.logId + "  " + core.short(e.hash));
  for (const e of sudahAda) console.log("  ⏭ DILEWATI (sudah terdaftar on-chain): " + e.logId);
  for (const e of bad) console.log("  [!] DILEWATI (" + e.reason + "): " + e.logId + " → " + e.file);

  if (akanKirim.length === 0) {
    console.log("Tidak ada entri yang perlu dikirim. Selesai.");
    return;
  }

  try {
    const tx = await contract.recordLogHashBatch(
      akanKirim.map((e) => e.logId),
      akanKirim.map((e) => e.hash)
    );
    console.log("⏳ transaksi batch terkirim:", tx.hash);
    const rc = await tx.wait();
    const gas = BigInt(rc.gasUsed.toString());
    console.log("[OK] " + akanKirim.length + " logId terkunci on-chain dalam 1 transaksi.");
    console.log("   gas total : " + gas.toString());
    console.log("   per log   : " + (gas / BigInt(akanKirim.length)).toString() + " gas");
    const link = core.explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    core.die(core.explainError(contract, err));
  }
}

async function main() {
  const [mode, logFile, logId, intervalArg, maxIterArg] = process.argv.slice(2);

  if (mode === "record") {
    if (!logFile || !logId) core.die("Pakai: node logCollector.js record <fileLog> <logId>");
    await cmdRecord(logFile, logId);
  } else if (mode === "watch") {
    if (!logFile || !logId) {
      core.die("Pakai: node logCollector.js watch <fileLog> <logId> [intervalDetik] [maxIterasi]");
    }
    await cmdWatch(logFile, logId, core.argNumber(intervalArg, 5), core.argNumber(maxIterArg, 0));
  } else if (mode === "batch") {
    if (!logFile) core.die("Pakai: node logCollector.js batch <manifest.txt>");
    await cmdBatch(logFile);
  } else {
    console.log(`
logCollector.js — Backend Log Collector (logHash = SHA-256 seluruh file)

  node logCollector.js record <fileLog> <logId>
  node logCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]
  node logCollector.js batch  <manifest.txt>

  [intervalDetik] default 5 · [maxIterasi] default 0 (jalan terus)
  batch  : banyak logId dalam satu transaksi (recordLogHashBatch) — hemat gas
Manifest batch = file teks, satu entri per baris:  <logId> <path file log>
Env: RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY [, ABI_PATH]
      — atau isi integration/backend/.env
`);
  }
}

main().catch((e) => core.die(e.message || String(e)));
