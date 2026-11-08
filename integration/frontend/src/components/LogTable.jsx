import { fmtTime, fmtAgo, shortHash, shortAddr } from "../lib/format.js";

export default function LogTable({ rows, selected, onSelect, filter, setFilter, onlyTampered, setOnlyTampered, onExport }) {
  const visible = rows.filter((r) => {
    if (onlyTampered && !r.isTampered) return false;
    if (!filter) return true;
    return r.logId.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <div className="rounded border border-soc-line bg-soc-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-soc-line px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-slate-400">Registry log on-chain</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="cari logId…"
          className="ml-auto w-48 rounded border border-soc-line bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
        />
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input type="checkbox" checked={onlyTampered} onChange={(e) => setOnlyTampered(e.target.checked)} />
          hanya tampered
        </label>
        <button onClick={onExport} className="rounded border border-soc-line px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
          export CSV
        </button>
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead className="sticky top-0 bg-slate-900/95 text-slate-400">
            <tr>
              <th className="px-3 py-2">logId</th>
              <th className="px-3 py-2">hash</th>
              <th className="px-3 py-2">direkam</th>
              <th className="px-3 py-2">diverifikasi</th>
              <th className="px-3 py-2">oleh</th>
              <th className="px-3 py-2">status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  belum ada log terdaftar (jalankan collector / logCollector record)
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={r.logId}
                onClick={() => onSelect(r.logId)}
                className={`cursor-pointer border-t border-soc-line/60 hover:bg-slate-800/50 ${selected === r.logId ? "bg-slate-800/70" : ""}`}
              >
                <td className="px-3 py-2 text-slate-200">{r.logId}</td>
                <td className="px-3 py-2 text-slate-400">{shortHash(r.hash)}</td>
                <td className="px-3 py-2 text-slate-400" title={fmtTime(r.timestamp)}>
                  {fmtAgo(r.timestamp)}
                </td>
                <td className="px-3 py-2 text-slate-400">{r.verifiedAt ? fmtAgo(r.verifiedAt) : "-"}</td>
                <td className="px-3 py-2 text-slate-400">{shortAddr(r.recordedBy)}</td>
                <td className="px-3 py-2">
                  {r.isTampered ? (
                    <span className="rounded bg-red-950 px-2 py-0.5 text-red-300">🔴 TAMPERED</span>
                  ) : (
                    <span className="rounded bg-emerald-950 px-2 py-0.5 text-emerald-300">🟢 AMAN</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
