"use strict";
/**
 * test/batch-queue.test.js — unit test logika antrean collectorService.js
 * ---------------------------------------------------------------------------
 * Murni: tanpa jaringan, tanpa kontrak, tanpa filesystem.
 * Jalankan: npm run test:backend
 */

const assert = require("assert");
const queue = require("../lib/batch-queue");

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// parseIndex
// ---------------------------------------------------------------------------
t("parseIndex: baris JSON valid jadi entri, baris kosong dilewati", () => {
  const text = [
    '{"logId":"victim-server/auth-1","file":"auth-1.log","lines":20}',
    "",
    '{"logId":"victim-server/auth-2","file":"auth-2.log"}',
    "",
  ].join("\n");
  const { entries, invalid } = queue.parseIndex(text);
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], { logId: "victim-server/auth-1", file: "auth-1.log", lines: 20 });
  assert.strictEqual(invalid.length, 0);
});

t("parseIndex: JSON rusak / tanpa logId / logId duplikat dikumpulkan, tidak melempar", () => {
  const text = [
    '{"logId":"a","file":"a.log"}',
    "{bukan json",
    '{"file":"tanpa-id.log"}',
    '{"logId":"a","file":"a-lagi.log"}',
  ].join("\n");
  const { entries, invalid } = queue.parseIndex(text);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(invalid.length, 3);
  assert.match(invalid.map((i) => i.reason).join(" | "), /JSON rusak/);
  assert.match(invalid.map((i) => i.reason).join(" | "), /field logId/);
  assert.match(invalid.map((i) => i.reason).join(" | "), /duplikat/);
});

t("parseIndex: input kosong/null aman", () => {
  assert.deepStrictEqual(queue.parseIndex("").entries, []);
  assert.deepStrictEqual(queue.parseIndex(null).entries, []);
});

// ---------------------------------------------------------------------------
// pendingRecords
// ---------------------------------------------------------------------------
t("pendingRecords: hanya logId yang belum ada di state", () => {
  const entries = [
    { logId: "a", file: "a.log" },
    { logId: "b", file: "b.log" },
  ];
  const state = { a: { file: "a.log", root: "0x1", lastCheck: 1 } };
  const pending = queue.pendingRecords(entries, state);
  assert.deepStrictEqual(pending.map((p) => p.logId), ["b"]);
});

t("pendingRecords: state kosong → semua entri pending", () => {
  const entries = [{ logId: "a", file: "a.log" }];
  assert.strictEqual(queue.pendingRecords(entries, {}).length, 1);
  assert.strictEqual(queue.pendingRecords(entries, null).length, 1);
});

// ---------------------------------------------------------------------------
// dueVerifications
// ---------------------------------------------------------------------------
t("dueVerifications: lewat interval → due, belum lewat → tidak", () => {
  const now = 1_000_000;
  const state = {
    lama: { file: "lama.log", lastCheck: now - 60_000 },
    baru: { file: "baru.log", lastCheck: now - 1_000 },
  };
  const due = queue.dueVerifications(state, now, 30_000);
  assert.deepStrictEqual(due.map((d) => d.logId), ["lama"]);
});

t("dueVerifications: yang sudah tampered TIDAK dicek ulang (flag on-chain satu arah)", () => {
  const now = 1_000_000;
  const state = { rusak: { file: "rusak.log", lastCheck: 0, tampered: true } };
  assert.strictEqual(queue.dueVerifications(state, now, 1).length, 0);
});

t("dueVerifications: rekaman tanpa file / tanpa lastCheck dianggap due", () => {
  const now = 1_000_000;
  const state = { a: { root: "0x" }, b: { file: "b.log" } };
  const due = queue.dueVerifications(state, now, 30_000).map((d) => d.logId);
  assert.deepStrictEqual(due, ["b"]);
});

t("dueVerifications: filter logIds membatasi pemeriksaan", () => {
  const now = 1_000_000;
  const state = {
    a: { file: "a.log", lastCheck: 0 },
    b: { file: "b.log", lastCheck: 0 },
  };
  const due = queue.dueVerifications(state, now, 1, ["b"]);
  assert.deepStrictEqual(due.map((d) => d.logId), ["b"]);
});

// ---------------------------------------------------------------------------
// update state
// ---------------------------------------------------------------------------
t("recordStateUpdate: recordedAt tidak berubah saat update ulang, tampered reset false", () => {
  const prev = { file: "a.log", root: "0x1", recordedAt: 111, lastCheck: 111, tampered: true };
  const next = queue.recordStateUpdate(prev, { file: "a.log", root: "0x2", nowMs: 999 });
  assert.strictEqual(next.recordedAt, 111);
  assert.strictEqual(next.lastCheck, 999);
  assert.strictEqual(next.root, "0x2");
  assert.strictEqual(next.tampered, false);
});

t("verifyStateUpdate: cocok → tampered false, beda → tampered true", () => {
  const ok = queue.verifyStateUpdate({ tampered: true }, { isMatch: true, nowMs: 5 });
  assert.strictEqual(ok.tampered, false);
  assert.strictEqual(ok.lastCheck, 5);
  const bad = queue.verifyStateUpdate({}, { isMatch: false, nowMs: 6 });
  assert.strictEqual(bad.tampered, true);
});

t("summarize: hitung total dan daftar yang tampered", () => {
  const s = queue.summarize({
    a: { file: "a", tampered: false },
    b: { file: "b", tampered: true },
    c: { file: "c" },
  });
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.tampered, 1);
  assert.deepStrictEqual(s.tamperedIds, ["b"]);
  assert.deepStrictEqual(queue.summarize(null), { total: 0, tampered: 0, tamperedIds: [] });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
(async () => {
  console.log("\nBatch queue (collectorService) — unit test\n");
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("  ✔ " + name);
      pass++;
    } catch (err) {
      console.error("  ✘ " + name + "\n      " + (err.message || err));
      fail++;
    }
  }
  console.log("\n  " + pass + " passing" + (fail ? ", " + fail + " failing" : "") + "\n");
  process.exit(fail ? 1 : 0);
})();
