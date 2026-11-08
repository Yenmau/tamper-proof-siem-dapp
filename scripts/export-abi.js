#!/usr/bin/env node
// scripts/export-abi.js — hasil compile Hardhat -> file yang dipakai tim.
//
//   npm run export-abi
//
// Menulis:
//   contracts/SIEMLogger.json          ABI saja (array), dipakai backend & frontend
//   contracts/SIEMLogger.bytecode.txt  bytecode (0x…), byte-for-byte sama dengan
//                                      hasil compile (jangan diubah .gitattributes-nya)
//
// Jalankan SETELAH `npm run compile` (atau `npm test` yang ikut meng-compile).
// Tujuannya supaya ABI yang di-commit selalu sinkron dengan kontrak — dulu file
// ini dibuat manual, gampang lupa diperbarui setelah kontrak diubah.
//
// CATATAN soal bytecode: beberapa byte terakhir hasil compile adalah metadata
// (hash IPFS) yang ikut berubah kalau line ending file sumber atau build
// compiler berbeda — jadi bytecode.txt bisa berbeda antara Windows (CRLF) dan
// runner Linux (LF) walau kontrak & setelan compile-nya sama. Karena itu CI
// hanya membandingkan ABI; bytecode.txt disimpan sebagai referensi build lokal.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "artifacts", "contracts", "SIEMLogger.sol", "SIEMLogger.json");
const ABI_OUT = path.join(ROOT, "contracts", "SIEMLogger.json");
const BYTECODE_OUT = path.join(ROOT, "contracts", "SIEMLogger.bytecode.txt");

if (!fs.existsSync(ARTIFACT)) {
  console.error("❌ Artifact belum ada. Jalankan dulu: npm run compile");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
const abi = artifact.abi;
if (!Array.isArray(abi) || abi.length === 0) {
  console.error("❌ ABI kosong di artifact:", ARTIFACT);
  process.exit(1);
}

// Tulis dengan LF saja (newline: "\n") supaya hasilnya sama di Windows & Linux.
fs.writeFileSync(ABI_OUT, JSON.stringify(abi, null, 2) + "\n", { encoding: "utf8", newline: "\n" });
fs.writeFileSync(BYTECODE_OUT, artifact.bytecode + "\n", { encoding: "utf8", newline: "\n" });

const fn = abi.filter((e) => e.type === "function").map((e) => e.name);
const ev = abi.filter((e) => e.type === "event").map((e) => e.name);
const er = abi.filter((e) => e.type === "error").map((e) => e.name);

console.log(`✅ ABI  -> ${path.relative(ROOT, ABI_OUT)} (${abi.length} entri)`);
console.log(`   fungsi (${fn.length}): ${fn.join(", ")}`);
console.log(`   event  (${ev.length}): ${ev.join(", ")}`);
console.log(`   error  (${er.length}): ${er.join(", ")}`);
console.log(`✅ bytecode -> ${path.relative(ROOT, BYTECODE_OUT)} (${artifact.bytecode.length} char)`);
