"use strict";

function parseIndex(text) {
  const entries = [];
  const invalid = [];
  const seen = new Set();
  String(text || "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === "") return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (err) {
        invalid.push({ line: i + 1, reason: "JSON rusak" });
        return;
      }
      if (!obj || typeof obj.logId !== "string" || typeof obj.file !== "string") {
        invalid.push({ line: i + 1, reason: "field logId/file tidak ada" });
        return;
      }
      if (seen.has(obj.logId)) {
        invalid.push({ line: i + 1, reason: "logId duplikat: " + obj.logId });
        return;
      }
      seen.add(obj.logId);
      entries.push({ logId: obj.logId, file: obj.file, lines: obj.lines });
    });
  return { entries, invalid };
}

function pendingRecords(entries, state) {
  const known = state || {};
  return (entries || []).filter((e) => !known[e.logId]);
}

function dueVerifications(state, nowMs, intervalMs, logIds) {
  const known = state || {};
  const only = Array.isArray(logIds) && logIds.length > 0 ? new Set(logIds) : null;
  const due = [];
  for (const [logId, rec] of Object.entries(known)) {
    if (!rec || !rec.file) continue;
    if (only && !only.has(logId)) continue;
    if (rec.tampered) continue;
    const last = Number(rec.lastCheck || 0);
    if (!Number.isFinite(last) || nowMs - last >= intervalMs) {
      due.push({ logId, file: rec.file });
    }
  }
  return due;
}

function recordStateUpdate(prev, { file, root, nowMs }) {
  return {
    ...(prev || {}),
    file,
    root,
    recordedAt: (prev && prev.recordedAt) || nowMs,
    lastCheck: nowMs,
    tampered: false,
  };
}

function verifyStateUpdate(prev, { isMatch, nowMs }) {
  const base = { ...(prev || {}) };
  base.lastCheck = nowMs;
  if (isMatch === true) base.tampered = false;
  if (isMatch === false) base.tampered = true;
  return base;
}

function summarize(state) {
  const recs = Object.entries(state || {});
  const tampered = recs.filter(([, r]) => r && r.tampered).map(([id]) => id);
  return { total: recs.length, tampered: tampered.length, tamperedIds: tampered };
}

module.exports = {
  parseIndex,
  pendingRecords,
  dueVerifications,
  recordStateUpdate,
  verifyStateUpdate,
  summarize,
};
