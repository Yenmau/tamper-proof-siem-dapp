import { fmtTime } from "../lib/format.js";

const tone = {
  ok: "text-emerald-300 border-emerald-700/60",
  bad: "text-red-300 border-red-700/60",
  info: "text-sky-300 border-sky-800/60",
};

export default function EventStream({ events }) {
  return (
    <div className="rounded border border-soc-line bg-soc-panel">
      <div className="border-b border-soc-line px-4 py-2 text-xs uppercase tracking-wide text-slate-400">
        Event stream (event on-chain + aktivitas dashboard)
      </div>
      <ul className="max-h-64 overflow-auto p-3 font-mono text-xs">
        {events.length === 0 && <li className="text-slate-500">(belum ada event)</li>}
        {events.map((e, i) => (
          <li key={i} className={`mb-1 rounded border-l-2 bg-slate-900/40 px-2 py-1 ${tone[e.kind] || tone.info}`}>
            <span className="text-slate-500">{fmtTime(e.at)} </span>
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
