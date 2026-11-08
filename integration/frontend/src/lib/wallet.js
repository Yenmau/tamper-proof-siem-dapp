// src/lib/wallet.js
//
// Login pakai wallet address + klien API off-chain.
//
// Alurnya:
//   1. `connectWallet`  -> minta akun ke MetaMask (eth_requestAccounts)
//   2. role dibaca dari KONTRAK (`getRoleName`) — bukan dari database, supaya
//      otoritas tidak bisa dipalsukan di sisi klien
//   3. setiap request tulis ke API off-chain ditandatangani (`personal_sign`)
//      atas pesan yang memuat timestamp + nonce, lalu diverifikasi server
//      DAN dicek role-nya lagi lewat kontrak.
//
// Pesan & encode base64 di bawah HARUS sama dengan integration/backend/api/lib/auth.js
// (format pesan, dan pengiriman base64 karena header HTTP tidak boleh berisi baris baru).

/** Bangun pesan kanonik — cermin dari buildMessage() di backend. */
export function buildMessage({ wallet, ts, nonce }) {
  return ["SIEM Off-Chain API", `wallet: ${String(wallet).toLowerCase()}`, `timestamp: ${ts}`, `nonce: ${nonce}`].join("\n");
}

function acakNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Header autentikasi untuk satu request (tanda tangan sekali pakai). */
export async function authHeaders(signer, walletAddr) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = acakNonce();
  const message = buildMessage({ wallet: walletAddr, ts, nonce });
  const signature = await signer.signMessage(message);
  return {
    "x-wallet": walletAddr,
    // btoa aman di sini karena pesan hanya berisi ASCII
    "x-message": btoa(message),
    "x-signature": signature,
  };
}

/**
 * Panggil API off-chain. `signer` boleh null untuk request publik (hanya
 * /api/health yang publik; endpoint lain akan menjawab 401 dengan jelas).
 */
export async function apiFetch(config, signer, method, path, body) {
  const base = config.apiBase || "http://127.0.0.1:8089";
  const headers = { "content-type": "application/json" };
  if (signer) {
    const walletAddr = (await signer.getAddress()).toLowerCase();
    Object.assign(headers, await authHeaders(signer, walletAddr));
  }
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    const e = new Error(`Tidak bisa menghubungi API off-chain (${base}). ${err.message || err}`);
    e.network = true;
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* respons tanpa body */
  }
  if (!res.ok) {
    const e = new Error(data?.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.detail = data?.detail;
    throw e;
  }
  return data;
}

/** Sederhana: alamat ini ber-role apa menurut kontrak? */
export function bolehNulis(role) {
  return role === "ADMIN" || role === "SOC_ANALYST";
}
export function bolehHapus(role) {
  return role === "ADMIN";
}
