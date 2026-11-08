"use strict";
/**
 * batch-queue.js — logika antrean untuk collectorService.js
 * ---------------------------------------------------------------------------
 * Semua fungsi di sini MURNI (tanpa jaringan, tanpa DB, tanpa filesystem) supaya
 * bisa diuji tanpa node blockchain. Tugasnya hanya menjawab:
 *
 *   - batch mana yang BELUM pernah direkam on-chain?
 *   - batch mana yang sudah waktunya dicek ulang integritasnya?
 *
 * Konsep "state" = objek { [logId]: { file, root, recordedAt, lastCheck, tampered } }.
 */

/**
 * Baca index.ndjson yang ditulis log-shipper (1 JSON per baris).
 * Baris kosong dilewati; baris rusak dikumpulkan, tidak menggagalkan semuanya.
 *
 * @returns {{entries: {logId: string, file: string, lines?: number}[], invalid: {line: number, reason: string}[]}}
 */
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

/** Entri index yang belum ada di state → harus direkam on-chain. */
function pendingRecords(entries, state) {
  const known = state || {};
  return (entries || []).filter((e) => !known[e.logId]);
}

/**
 * Entri yang sudah direkam tapi sudah lewat `intervalMs` sejak pengecekan
 * terakhir → harus diverifikasi ulang. Entri yang sudah `tampered` tidak dicek
 * lagi: flag `isTampered` di kontrak satu arah (tidak bisa kembali ke false),
 * jadi transaksi tambahan hanya membuang gas.
 */
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

/** Rekor state baru untuk logId yang baru direkam. */
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

/** Rekor state setelah pengecekan integritas. */
function verifyStateUpdate(prev, { isMatch, nowMs }) {
  const base = { ...(prev || {}) };
  base.lastCheck = nowMs;
  if (isMatch === true) base.tampered = false;
  if (isMatch === false) base.tampered = true;
  return base;
}

/** Ringkasan untuk log/CLI. */
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
