import { fmtTime, shortHash, shortAddr } from "../lib/format.js";
import ProofPanel from "./ProofPanel.jsx";

export default function LogDetail({ entry, config, contract, onEvent }) {
  if (!entry) {
    return (
      <div className="rounded border border-soc-line bg-soc-panel p-4 text-sm text-slate-500">
        Pilih satu log di tabel untuk melihat detail + bukti Merkle per baris.
      </div>
    );
  }
  const rows = [
    ["logId", entry.logId],
    ["Merkle Root on-chain", entry.hash],
    ["Direkam", fmtTime(entry.timestamp)],
    ["Verifikasi terakhir", entry.verifiedAt ? fmtTime(entry.verifiedAt) : "- (belum pernah dicek backend)"],
    ["Direkam oleh", shortAddr(entry.recordedBy)],
    ["Status", entry.isTampered ? "🔴 TAMPERED" : "🟢 AMAN"],
  ];
  return (
    <div className="rounded border border-soc-line bg-soc-panel p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-slate-400">Detail log</h3>
      <dl className="space-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-44 shrink-0 text-slate-500">{k}</dt>
            <dd className="break-all font-mono text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Status “TAMPERED” di atas berasal dari pengecekan terakhir oleh backend (hanya server yang memegang file log). Panel di bawah menghitung ulang
        sendiri di browser memakai Merkle proof → root on-chain, jadi tidak bergantung pada backend.
      </p>
      <ProofPanel config={config} contract={contract} logId={entry.logId} entry={entry} onEvent={onEvent} />
    </div>
  );
}
