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
// Merkle proof per baris (bukti kriptografis, bukan banding teks)
// ---------------------------------------------------------------------------
const SAMPLE_LINES = fs.readFileSync(SAMPLE, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");

t("proof: SETIAP baris file sampel bisa dibuktikan terhadap Merkle Root-nya", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const wit = 0;
  SAMPLE_LINES.forEach((line, i) => {
    const proof = core.merkleProofOfLine(SAMPLE_LINES, i);
    assert.ok(proof.length > 0, "proof baris " + i + " tidak boleh kosong");
    assert.strictEqual(core.verifyLineProof(line, proof, root), true, "baris " + i + " harus terbukti");
  });
  assert.strictEqual(wit, 0);
});

t("proof: baris yang DIUBAH tidak bisa dibuktikan (proof tidak menghasilkan root)", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const proof = core.merkleProofOfLine(SAMPLE_LINES, 1);
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[1], proof, root), true);
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[1] + " # disisipkan penyerang", proof, root), false);
});

t("proof: baris LAIN tetap terbukti walau satu baris di file diubah (inti klaim per-baris)", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const diubah = SAMPLE_LINES.slice();
  const iUbah = 1;
  diubah[iUbah] = "Oct 09 21:40:15 srv sshd[1025]: Failed password untuk root dari 10.0.0.66";
  assert.notStrictEqual(diubah[iUbah], SAMPLE_LINES[iUbah]);
  // baris yang diubah: proof-nya tidak lagi menghasilkan Merkle Root on-chain
  assert.strictEqual(core.verifyLineProof(diubah[iUbah], core.merkleProofOfLine(SAMPLE_LINES, iUbah), root), false);
  // baris lain tetap TERBUKTI identik — inilah yang tidak bisa dilakukan hash file utuh
  const lain = SAMPLE_LINES.map((_, i) => i).filter((i) => i !== iUbah);
  assert.ok(lain.length > 0, "sampel harus punya lebih dari 1 baris");
  for (const i of lain) {
    assert.strictEqual(core.verifyLineProof(diubah[i], core.merkleProofOfLine(SAMPLE_LINES, i), root), true, "baris " + i);
  }
});

t("proof: root yang dipalsukan menolak bukti yang sah", () => {
  const palsu = "0x" + "ab".repeat(32);
  const proof = core.merkleProofOfLine(SAMPLE_LINES, 0);
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[0], proof, palsu), false);
});

t("proof: input rusak (proof kosong / root bukan hex 32 byte / baris bukan string) → false, tidak melempar", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[0], [], root), false);
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[0], null, root), false);
  assert.strictEqual(core.verifyLineProof(SAMPLE_LINES[0], core.merkleProofOfLine(SAMPLE_LINES, 0), "0x"), false);
  assert.strictEqual(core.verifyLineProof(undefined, core.merkleProofOfLine(SAMPLE_LINES, 0), root), false);
});

t("proof: index di luar jangkauan → proof kosong (bukan crash)", () => {
  assert.deepStrictEqual(core.merkleProofOfLine(SAMPLE_LINES, -1), []);
  assert.deepStrictEqual(core.merkleProofOfLine(SAMPLE_LINES, SAMPLE_LINES.length + 5), []);
  assert.deepStrictEqual(core.merkleProofOfLine([], 0), []);
});

t("leafHashHex: konsisten dengan sha256(isi baris)", () => {
  const line = SAMPLE_LINES[0];
  const manual = "0x" + crypto.createHash("sha256").update(line).digest("hex");
  assert.strictEqual(core.leafHashHex(line), manual);
});

// ---------------------------------------------------------------------------
// Artefak bukti (sidecar <fileLog>.proofs.json)
// ---------------------------------------------------------------------------
t("buildProofArtifacts: root artefak sama dengan root on-chain (hashForMode) — tidak mengubah algoritma", () => {
  const root = core.hashForMode(core.MODE_MERKLE, SAMPLE).hash;
  const a = core.buildProofArtifacts(SAMPLE_LINES, "auth.log#test", root);
  assert.strictEqual(a.merkleRoot, root);
  assert.strictEqual(a.lineCount, SAMPLE_LINES.length);
  assert.strictEqual(a.format, core.PROOFS_FORMAT);
  assert.strictEqual(a.lines.length, SAMPLE_LINES.length);
});

t("saveProofArtifacts + loadProofArtifacts: round-trip utuh, dan menolak logId yang tidak cocok", () => {
  const logFileCopy = path.join(TMP, "copy-auth.log");
  fs.copyFileSync(SAMPLE, logFileCopy);
  const root = core.hashForMode(core.MODE_MERKLE, logFileCopy).hash;
  const a = core.buildProofArtifacts(SAMPLE_LINES, "auth.log#rt", root);
  const target = core.saveProofArtifacts(logFileCopy, a);
  assert.ok(fs.existsSync(target), "file bukti harus tertulis");

  const loaded = core.loadProofArtifacts(logFileCopy, "auth.log#rt", null);
  assert.strictEqual(loaded.logId, "auth.log#rt");
  assert.strictEqual(loaded.source, target);
  // bukti yang dimuat tetap lolos verifikasi terhadap root on-chain
  assert.strictEqual(core.verifyLineProof(loaded.lines[0].content, loaded.lines[0].proof, root), true);
  // logId lain tidak boleh memakai file bukti ini
  assert.strictEqual(core.loadProofArtifacts(logFileCopy, "auth.log#lain", null), null);
});

t("proofsPathFor: dua logId pada file yang SAMA tidak saling menimpa (pola rotasi log)", () => {
  const logFileCopy = path.join(TMP, "rotasi-auth.log");
  fs.copyFileSync(SAMPLE, logFileCopy);
  const root = core.hashForMode(core.MODE_MERKLE, logFileCopy).hash;

  const a1 = core.buildProofArtifacts(SAMPLE_LINES, "auth.log#2026-10-09", root);
  const a2 = core.buildProofArtifacts(SAMPLE_LINES, "auth.log#2026-10-10", root);
  const t1 = core.saveProofArtifacts(logFileCopy, a1);
  const t2 = core.saveProofArtifacts(logFileCopy, a2);
  assert.notStrictEqual(t1, t2, "dua logId harus punya file bukti berbeda");
  assert.ok(fs.existsSync(t1) && fs.existsSync(t2));

  assert.strictEqual(core.loadProofArtifacts(logFileCopy, "auth.log#2026-10-09", null).logId, "auth.log#2026-10-09");
  assert.strictEqual(core.loadProofArtifacts(logFileCopy, "auth.log#2026-10-10", null).logId, "auth.log#2026-10-10");
  assert.strictEqual(core.loadProofArtifacts(logFileCopy, "auth.log#2026-10-11", null), null, "logId yang belum direkam tidak punya bukti");
  assert.strictEqual(core.slugLogId("../../etc/passwd"), "etc-passwd", "logId tidak boleh keluar dari folder (path traversal)");
});

t("loadProofArtifacts: MongoDB dipakai lebih dulu kalau ada, file bukti jadi cadangan", () => {
  const fromDb = {
    logId: "auth.log#db",
    merkleRoot: "0x" + "cd".repeat(32),
    lines: [{ index: 0, content: "x", hash: core.leafHashHex("x"), proof: ["0x" + "11".repeat(32)] }],
  };
  const a = core.loadProofArtifacts(SAMPLE, "auth.log#db", fromDb);
  assert.strictEqual(a.source, "mongodb");
  assert.strictEqual(a.merkleRoot, fromDb.merkleRoot);
});

// ---------------------------------------------------------------------------
// Batch (manifest + recordLogHashBatch)
// ---------------------------------------------------------------------------
t("parseManifest: komentar & baris kosong diabaikan, path berspasi tetap utuh", () => {
  const entries = core.parseManifest(
    ["# contoh manifest", "", "auth.log#01 /var/log/auth.log", "  sys.log#01  ./log dir/sys.log  ", "# akhir"].join("\n")
  );
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], { logId: "auth.log#01", file: "/var/log/auth.log" });
  assert.strictEqual(entries[1].file, "./log dir/sys.log");
});

t("parseManifest: manifest kosong / format salah / logId duplikat → error jelas", () => {
  assert.throws(() => core.parseManifest("# hanya komentar\n\n"), /kosong/i);
  assert.throws(() => core.parseManifest("auth.log#01"), /format/i);
  assert.throws(() => core.parseManifest("a#1 x.log\na#1 y.log\n"), /duplikat/i);
});

t("prepareBatchEntries: file hilang/kosong dipisah supaya tidak menggagalkan batch (kontrak all-or-nothing)", () => {
  const valid = path.join(TMP, "batch-valid.log");
  fs.copyFileSync(SAMPLE, valid);
  const entries = [
    { logId: "ok#1", file: valid },
    { logId: "hilang#1", file: MISSING_FILE },
    { logId: "kosong#1", file: EMPTY_FILE },
  ];
  const { ok, bad } = core.prepareBatchEntries(core.MODE_MERKLE, entries);
  assert.strictEqual(ok.length, 1);
  assert.strictEqual(ok[0].logId, "ok#1");
  assert.strictEqual(ok[0].hash, core.hashForMode(core.MODE_MERKLE, valid).hash);
  assert.strictEqual(bad.length, 2);
  assert.deepStrictEqual(bad.map((b) => b.logId).sort(), ["hilang#1", "kosong#1"]);
});

t("prepareBatchEntries: mode file tetap menerima file tanpa baris berisi", () => {
  const { ok, bad } = core.prepareBatchEntries(core.MODE_FILE, [{ logId: "kosong#2", file: EMPTY_FILE }]);
  assert.strictEqual(bad.length, 0);
  assert.strictEqual(ok[0].hash, core.hashForMode(core.MODE_FILE, EMPTY_FILE).hash);
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
