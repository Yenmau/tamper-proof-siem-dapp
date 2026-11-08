export default function StatCards({ stats }) {
  const cards = [
    { label: "Log terdaftar", value: stats.total, accent: "#38bdf8" },
    { label: "Aman", value: stats.safe, accent: "#22c55e" },
    { label: "Tampered", value: stats.tampered, accent: "#ef4444" },
    { label: "Alarm sesi ini", value: stats.alarms, accent: "#f59e0b" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="relative overflow-hidden rounded border border-soc-line bg-soc-panel p-4 pb-6">
          <p className="text-xs uppercase tracking-wide text-slate-400">{c.label}</p>
          <p className="mt-1 text-3xl font-semibold text-slate-100">{c.value}</p>
          <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: c.accent }} />
        </div>
      ))}
    </div>
  );
}
