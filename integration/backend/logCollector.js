#!/usr/bin/env node
/**
 * logCollector.js — Backend Log Collector (mode: SHA-256 file utuh)
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
 * Skrip ini TIDAK butuh MongoDB. Pasangannya adalah merkleCollector.js, yang
 * memakai Merkle Root sebagai `logHash` — jangan pakai dua skrip untuk logId
 * yang sama (lihat integration/README.md).
 *
 * ---------------------------------------------------------------------------
 * CARA PAKAI
 * ---------------------------------------------------------------------------
 *   node logCollector.js record <fileLog> <logId>
 *   node logCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]
 *
 * maxIterasi 0 / tidak diisi = jalan terus (daemon). Contoh:
 *   node logCollector.js record ./sample/auth.log "auth.log#2026-10-09"
 *   node logCollector.js watch  ./sample/auth.log "auth.log#2026-10-09" 5
 *
 * ---------------------------------------------------------------------------
 * ENV YANG DIBUTUHKAN
 * ---------------------------------------------------------------------------
 * Nilainya boleh ditaruh di file `integration/backend/.env` (salin dari
 * `.env.example`) — dibaca otomatis oleh skrip ini. Environment variable dari
 * shell akan menang kalau keduanya diisi.
 *
 *   RPC_URL            endpoint testnet, mis. https://rpc.sepolia.org
 *   CONTRACT_ADDRESS   alamat hasil deploy (lihat deployments.json)
 *   PRIVATE_KEY        private key akun yang SUDAH diberi role
 *                      SOC_ANALYST atau ADMIN  (jangan commit file .env!)
 *   ABI_PATH           opsional, default ../../contracts/SIEMLogger.json
 */

const core = require("./lib/collector-core");

const MODE = core.MODE_FILE;

// ---------------------------------------------------------------------------
// Mode: record
// ---------------------------------------------------------------------------
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
    console.log("✅ hash terkunci on-chain. gas:", rc.gasUsed.toString());
    const link = core.explorerLink(tx.hash);
    if (link) console.log("   " + link);
  } catch (err) {
    core.die(core.explainError(contract, err));
  }
}

// ---------------------------------------------------------------------------
// Mode: watch
// ---------------------------------------------------------------------------
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

    // 1) Cek GRATIS dulu (view, tidak menulis state, tidak butuh gas)
    let isMatch;
    try {
      isMatch = await contract.verifyLogIntegrityView(logId, info.hash);
    } catch (err) {
      core.die(core.explainError(contract, err));
    }

    const stamp = new Date().toLocaleTimeString("id-ID");

    if (isMatch) {
      console.log(`[${stamp}] #${iteration} 🟢 AMAN     hash cocok (${core.short(info.hash)})`);
      return;
    }

    // 2) Tidak cocok — tapi pastikan dulu ini bukan "salah skrip".
    //    Kalau hash on-chain justru cocok dengan hasil mode Merkle untuk file
    //    yang sama, ini bukan tampering, cuma logId-nya dikelola
    //    merkleCollector.js. Jangan cemari isTampered dengan alarm palsu
    //    (flag itu satu arah, tidak bisa dikembalikan ke false).
    const mismatch = await core.detectModeMismatch(contract, logId, logFile, MODE);
    if (mismatch) {
      console.log(`[${stamp}] #${iteration} ⚠️  SALAH SKRIP — logId ini direkam dengan mode "${mismatch.otherMode}"`);
      console.log("            hash on-chain cocok dengan hasil hitung mode itu, jadi isi file TIDAK berubah.");
      console.log("            Alarm tidak dikirim. Pakai skrip merkleCollector.js untuk logId ini.");
      return;
    }

    // 3) Benar-benar tidak cocok -> kirim transaksi supaya alarm tercatat on-chain
    tamperCount++;
    if (info.missing) {
      console.log(`[${stamp}] #${iteration} 🔴 FILE LOG HILANG! ${logFile} sudah tidak ada di server`);
      console.log("            → penghapusan log = tampering. Mengirim transaksi verifyLogIntegrity…");
    } else {
      console.log(`[${stamp}] #${iteration} 🔴 TAMPERED! hash server ${core.short(info.hash)} ≠ hash on-chain`);
      console.log("            → mengirim transaksi verifyLogIntegrity untuk memicu event TamperingDetected…");
    }
    try {
      const tx = await contract.verifyLogIntegrity(logId, info.hash);
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
      const link = core.explorerLink(tx.hash);
      if (link) console.log("               " + link);
      console.log("            → dashboard SOC (Joseph) sekarang menerima event ini secara real-time.");
    } catch (err) {
      console.error("            ❌ gagal mengirim transaksi:", core.explainError(contract, err));
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
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
  } else {
    console.log(`
logCollector.js — Backend Log Collector (logHash = SHA-256 seluruh file)

  node logCollector.js record <fileLog> <logId>
  node logCollector.js watch  <fileLog> <logId> [intervalDetik] [maxIterasi]

  [intervalDetik] default 5 · [maxIterasi] default 0 (jalan terus)
Env: RPC_URL, CONTRACT_ADDRESS, PRIVATE_KEY [, ABI_PATH]
      — atau isi integration/backend/.env
`);
  }
}

main().catch((e) => core.die(e.message || String(e)));
