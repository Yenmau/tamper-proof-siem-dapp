export const shortHash = (h, head = 10, tail = 6) =>
  typeof h === "string" && h.length > head + tail + 2 ? `${h.slice(0, head)}…${h.slice(-tail)}` : String(h ?? "-");

export const shortAddr = (a) => (typeof a === "string" && a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? "-"));

export const fmtTime = (ts) => {
  const n = Number(ts);
  if (!n) return "-";
  return new Date(n * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
};

export const fmtAgo = (ts) => {
  const n = Number(ts);
  if (!n) return "-";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - n));
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
};

export const ROLE_NAME = { 0: "NONE", 1: "AUDITOR", 2: "SOC_ANALYST", 3: "ADMIN" };
