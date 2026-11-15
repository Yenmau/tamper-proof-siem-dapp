#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "artifacts", "contracts", "SIEMLogger.sol", "SIEMLogger.json");
const ABI_OUT = path.join(ROOT, "contracts", "SIEMLogger.json");
const BYTECODE_OUT = path.join(ROOT, "contracts", "SIEMLogger.bytecode.txt");

if (!fs.existsSync(ARTIFACT)) {
  console.error("[GAGAL] Artifact belum ada. Jalankan dulu: npm run compile");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
const abi = artifact.abi;
if (!Array.isArray(abi) || abi.length === 0) {
  console.error("[GAGAL] ABI kosong di artifact:", ARTIFACT);
  process.exit(1);
}

fs.writeFileSync(ABI_OUT, JSON.stringify(abi, null, 2) + "\n", { encoding: "utf8", newline: "\n" });
fs.writeFileSync(BYTECODE_OUT, artifact.bytecode + "\n", { encoding: "utf8", newline: "\n" });

const fn = abi.filter((e) => e.type === "function").map((e) => e.name);
const ev = abi.filter((e) => e.type === "event").map((e) => e.name);
const er = abi.filter((e) => e.type === "error").map((e) => e.name);

console.log(`[OK] ABI  -> ${path.relative(ROOT, ABI_OUT)} (${abi.length} entri)`);
console.log(`   fungsi (${fn.length}): ${fn.join(", ")}`);
console.log(`   event  (${ev.length}): ${ev.join(", ")}`);
console.log(`   error  (${er.length}): ${er.join(", ")}`);
console.log(`[OK] bytecode -> ${path.relative(ROOT, BYTECODE_OUT)} (${artifact.bytecode.length} char)`);
