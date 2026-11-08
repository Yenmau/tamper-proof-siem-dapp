// Verifikasi Merkle proof DI BROWSER (WebCrypto SHA-256) — tidak mempercayai
// backend: patokannya tetap Merkle Root yang tersimpan on-chain.
// Algoritma harus sama dengan integration/backend/lib/collector-core.js:
// leaf = sha256(isi baris), parent = sha256(min||max) karena sortPairs: true.

const enc = new TextEncoder();

export async function sha256(data) {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

export const toHex = (bytes) => "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex) {
  const s = String(hex).replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function cmp(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

async function hashPair(a, b) {
  const [x, y] = cmp(a, b) > 0 ? [b, a] : [a, b];
  const buf = new Uint8Array(x.length + y.length);
  buf.set(x);
  buf.set(y, x.length);
  return sha256(buf);
}

/** Benarkah `line` adalah isi baris yang tersegel di dalam `root`? */
export async function verifyLineProof(line, proofHex, root) {
  if (typeof line !== "string" || !Array.isArray(proofHex) || proofHex.length === 0) return false;
  let node = await sha256(line);
  for (const p of proofHex) node = await hashPair(node, fromHex(p));
  return toHex(node) === String(root).toLowerCase();
}

/** Merkle Root dari daftar baris — dipakai untuk mengecek ulang isi file batch. */
export async function merkleRootOfLines(lines) {
  if (!lines || lines.length === 0) return null;
  let layer = [];
  for (const line of lines) layer.push(await sha256(line));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) next.push(await hashPair(layer[i], layer[i + 1]));
      else next.push(layer[i]);
    }
    layer = next;
  }
  return toHex(layer[0]);
}

/** Sama dengan slugLogId() di collector-core.js — dipakai untuk nama file bukti. */
export const slugLogId = (logId) =>
  (String(logId).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "log");

export function parseIndexNdjson(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.logId && obj.file) out.push(obj);
    } catch (_) {
      /* baris rusak dilewati */
    }
  }
  return out;
}

export const splitLines = (text) => String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
