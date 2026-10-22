"use strict";
/**
 * test/core.test.js — unit test untuk lib/collector-core.js
 * ------------------------------------------------------------------
 * Tidak butuh jaringan, kontrak, maupun MongoDB: semua yang diuji murni
 * perhitungan hash, penanganan file aneh (hilang / kosong), dan deteksi
 * "salah skrip" memakai stub kontrak.
 *
 * Jalankan: npm run test:backend
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { MerkleTree } = require("merkletreejs");
const core = require("../lib/collector-core");

const SAMPLE = path.join(__dirname, "..", "sample", "auth.log");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "siem-test-"));
const EMPTY_FILE = path.join(TMP, "kosong.log");
const MISSING_FILE = path.join(TMP, "tidak-ada.log");
fs.writeFileSync(EMPTY_FILE, "\n\n   \n\n");

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------
t("mode file: cocok dengan SHA-256 manual seluruh isi file", () => {
  const manual = "0x" + crypto.createHash("sha256").update(fs.readFileSync(SAMPLE)).digest("hex");
  assert.strictEqual(core.hashForMode(core.MODE_FILE, SAMPLE).hash, manual);
});

t("mode merkle: cocok dengan perhitungan merkletreejs manual", () => {
  const lines = fs.readFileSync(SAMPLE, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const leaves = lines.map((l) => crypto.createHash("sha256").update(l).digest());
  const manual = new MerkleTree(leaves, (d) => crypto.createHash("sha256").update(d).digest(), { sortPairs: true }).getHexRoot();
  assert.strictEqual(core.hashForMode(core.MODE_MERKLE, SAMPLE).hash, manual);
});

t("merkle root selalu 66 karakter (siap dipindah ke bytes32 di v4.0)", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  assert.strictEqual(root.length, 66);
  assert.ok(/^0x[0-9a-f]{64}$/.test(root));
});

t("dua mode menghasilkan hash BERBEDA untuk file yang identik (dasar alarm palsu)", () => {
  const a = core.hashForMode(core.MODE_FILE, SAMPLE).hash;
  const b = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  assert.notStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// File aneh: hilang & kosong  (regresi bug "root = 0x")
// ---------------------------------------------------------------------------
t("file hilang → penanda HASH_FILE_MISSING di kedua mode (bukan crash)", () => {
  assert.strictEqual(core.hashForMode(core.MODE_FILE, MISSING_FILE).hash, core.HASH_FILE_MISSING);
  assert.strictEqual(core.hashForMode(core.MODE_MERKLE, MISSING_FILE).hash, core.HASH_FILE_MISSING);
  assert.strictEqual(core.hashForMode(core.MODE_MERKLE, MISSING_FILE).missing, true);
});

t("file tanpa baris berisi → HASH_FILE_EMPTY, BUKAN '0x' (dulu semua log kosong bisa ber-hash sama)", () => {
  const info = core.hashForMode(core.MODE_MERKLE, EMPTY_FILE);
  assert.strictEqual(info.hash, core.HASH_FILE_EMPTY);
  assert.notStrictEqual(info.hash, "0x");
  assert.strictEqual(info.empty, true);
});

t("merkleRootOfLines([]) mengembalikan null, bukan '0x' (fallback palsu dihapus)", () => {
  assert.strictEqual(core.merkleRootOfLines([]), null);
  assert.strictEqual(core.merkleRootOfLines(null), null);
});

// ---------------------------------------------------------------------------
// Deteksi "salah skrip" (logId direkam mode lain)
// ---------------------------------------------------------------------------
t("log direkam mode FILE, dicek dengan mode MERKLE → terdeteksi, bukan dianggap tampering", async () => {
  const fileHash = core.hashForMode(core.MODE_FILE, SAMPLE).hash;
  const stub = { getLogStatus: async () => [fileHash, 0n, false] };
  const mm = await core.detectModeMismatch(stub, "auth.log#x", SAMPLE, core.MODE_MERKLE);
  assert.ok(mm, "harus terdeteksi mismatch");
  assert.strictEqual(mm.otherMode, core.MODE_FILE);
});

t("log direkam mode MERKLE, dicek dengan mode FILE → terdeteksi juga", async () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const stub = { getLogStatus: async () => [root, 0n, false] };
  const mm = await core.detectModeMismatch(stub, "auth.log#x", SAMPLE, core.MODE_FILE);
  assert.ok(mm, "harus terdeteksi mismatch");
  assert.strictEqual(mm.otherMode, core.MODE_MERKLE);
});

t("mode sama (bukan kasus salah skrip) → tidak ada mismatch", async () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const stub = { getLogStatus: async () => [root, 0n, false] };
  assert.strictEqual(await core.detectModeMismatch(stub, "auth.log#x", SAMPLE, core.MODE_MERKLE), null);
});

t("hash on-chain yang benar-benar berbeda (tampering asli) → bukan mismatch, alarm tetap jalan", async () => {
  const stub = { getLogStatus: async () => ["0x" + "ab".repeat(32), 0n, false] };
  assert.strictEqual(await core.detectModeMismatch(stub, "auth.log#x", SAMPLE, core.MODE_MERKLE), null);
});

t("logId belum terdaftar (getLogStatus error) → null, tidak melempar", async () => {
  const stub = { getLogStatus: async () => { throw new Error("LogNotFound"); } };
  assert.strictEqual(await core.detectModeMismatch(stub, "belum#ada", SAMPLE, core.MODE_MERKLE), null);
});

// ---------------------------------------------------------------------------
// Argumen CLI
// ---------------------------------------------------------------------------
t("argNumber: nilai kosong/0/NaN pakai default, nilai positif dipakai", () => {
  assert.strictEqual(core.argNumber(undefined, 5), 5);
  assert.strictEqual(core.argNumber("0", 5), 5);
  assert.strictEqual(core.argNumber("abc", 5), 5);
  assert.strictEqual(core.argNumber("7", 5), 7);
});

// ---------------------------------------------------------------------------
// Runner sederhana (tanpa mocha, biar bisa jalan tanpa Hardhat)
// ---------------------------------------------------------------------------
(async () => {
  console.log("\nBackend collector core — unit test\n");
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
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("\n  " + pass + " passing" + (fail ? ", " + fail + " failing" : "") + "\n");
  process.exit(fail ? 1 : 0);
})();
