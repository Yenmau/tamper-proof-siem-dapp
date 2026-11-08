import { useState } from "react";
import { merkleRootOfLines, parseIndexNdjson, slugLogId, splitLines, verifyLineProof } from "../lib/merkle.js";
import { shortHash } from "../lib/format.js";

/**
 * Panel bukti: verifikasi Merkle proof tiap baris DI BROWSER terhadap Merkle Root
 * on-chain. Tidak memakai backend untuk memutuskan apa pun — file batch dan
 * artefak bukti cuma "bahan mentah", yang menentukan adalah root dari kontrak.
 */
export default function ProofPanel({ config, contract, logId, onEvent }) {
  const [state, setState] = useState({ status: "idle" });

  async function verify() {
    setState({ status: "loading" });
    try {
      const dataPath = config.dataPath || "/data";
      const status = await contract.getLogStatus(logId);
      const chainRoot = String(status[0]).toLowerCase();

      const idxRes = await fetch(`${dataPath}/index.ndjson`, { cache: "no-store" });
      const entries = idxRes.ok ? parseIndexNdjson(await idxRes.text()) : [];
      const entry = entries.find((e) => e.logId === logId);
      if (!entry) {
        setState({ status: "error", message: `logId ini tidak ada di index.ndjson (${dataPath}). Bukti per baris butuh file batch + artefaknya.` });
        return;
      }

      const fileRes = await fetch(`${dataPath}/${entry.file}`, { cache: "no-store" });
      const lines = fileRes.ok ? splitLines(await fileRes.text()) : null;

      const artRes = await fetch(`${dataPath}/${entry.file}.${slugLogId(logId)}.proofs.json`, { cache: "no-store" });
      const artifacts = artRes.ok ? await artRes.json() : null;

      let perLine = [];
      let proven = 0;
      let failed = 0;
      if (artifacts && lines) {
        for (const rec of artifacts.lines) {
          const now = lines[rec.index];
          const ok = now !== undefined && (await verifyLineProof(now, rec.proof, chainRoot));
          if (ok) proven++;
          else failed++;
          perLine.push({ index: rec.index, ok, asli: rec.content, sekarang: now });
        }
        perLine = perLine.filter((l) => !l.ok).slice(0, 5);
      }

      // Cek ulang GRATIS dari browser: hitung root file batch sekarang, tanya kontrak.
      let viewResult = null;
      let browserRoot = null;
      if (lines) {
        browserRoot = await merkleRootOfLines(lines);
        try {
          viewResult = await contract.verifyLogIntegrityView(logId, browserRoot);
        } catch (_) {
          viewResult = null;
        }
      }

      setState({
        status: "done",
        file: entry.file,
        chainRoot,
        artifacts,
        artifactsInSync: artifacts ? String(artifacts.merkleRoot).toLowerCase() === chainRoot : false,
        fileExists: Boolean(lines),
        lineCount: lines ? lines.length : 0,
        expectedLines: artifacts ? artifacts.lines.length : 0,
        proven,
        failed,
        perLine,
        browserRoot,
        viewResult,
      });
      onEvent?.(viewResult === false ? "bad" : "info", `prove ${logId}: ${proven} baris terbukti, ${failed} gagal`);
    } catch (err) {
      setState({ status: "error", message: err.message || String(err) });
    }
  }

  return (
    <div className="mt-4 rounded border border-soc-line bg-slate-900/40 p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-400">Bukti Merkle per baris</span>
        <button
          onClick={verify}
          disabled={state.status === "loading"}
          className="ml-auto rounded border border-sky-700 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-50"
        >
          {state.status === "loading" ? "memverifikasi…" : "verifikasi di browser"}
        </button>
      </div>

      {state.status === "error" && <p className="mt-2 text-xs text-amber-300">{state.message}</p>}

      {state.status === "done" && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-slate-400">
            File batch: <span className="font-mono text-slate-300">{state.file}</span> · root on-chain{" "}
            <span className="font-mono text-slate-300">{shortHash(state.chainRoot, 14, 8)}</span>
          </p>
          {!state.artifacts && (
            <p className="text-amber-300">
              Artefak bukti (…{slugLogId(logId)}.proofs.json) tidak ada di {config.dataPath}. Kalau collector memakai MongoDB, salin artefaknya ke folder itu
              atau jalankan collector tanpa <span className="font-mono">--no-db</span>.
            </p>
          )}
          {state.artifacts && !state.artifactsInSync && (
            <p className="text-amber-300">Root di artefak ≠ root on-chain — artefak ini bukan set yang direkam, hasil di bawah tidak bisa dipakai.</p>
          )}
          {state.artifacts && (
            <>
              <p className={state.failed === 0 ? "text-emerald-300" : "text-red-300"}>
                {state.failed === 0
                  ? `✅ ${state.proven} baris TERBUKTI identik dengan yang tersegel on-chain`
                  : `🔴 ${state.failed} dari ${state.expectedLines} baris TIDAK TERBUKTI (${state.proven} masih identik)`}
              </p>
              {state.perLine.map((l) => (
                <div key={l.index} className="rounded border border-red-900/60 bg-red-950/30 p-2 font-mono text-[11px] text-red-200">
                  <p>baris ke-{l.index}: {l.sekarang === undefined ? "baris sudah tidak ada" : "isi berubah"}</p>
                  <p className="text-red-300/70">asli : {l.asli}</p>
                  {l.sekarang !== undefined && <p className="text-red-300/70">baru : {l.sekarang}</p>}
                </div>
              ))}
            </>
          )}
          {state.viewResult !== null && (
            <p className={state.viewResult ? "text-emerald-300" : "text-red-300"}>
              Cek ulang gratis dari browser (verifyLogIntegrityView): {state.viewResult ? "🟢 hash server == hash on-chain" : "🔴 hash server ≠ hash on-chain"}
              <span className="text-slate-500"> · root hitung-browser {shortHash(state.browserRoot, 12, 8)}</span>
            </p>
          )}
          {!state.fileExists && <p className="text-red-300">File batch tidak ada di {config.dataPath} (mungkin dihapus penyerang).</p>}
        </div>
      )}
    </div>
  );
}
