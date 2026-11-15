
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

export async function authHeaders(signer, walletAddr) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = acakNonce();
  const message = buildMessage({ wallet: walletAddr, ts, nonce });
  const signature = await signer.signMessage(message);
  return {
    "x-wallet": walletAddr,
    "x-message": btoa(message),
    "x-signature": signature,
  };
}

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
  }
  if (!res.ok) {
    const e = new Error(data?.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.detail = data?.detail;
    throw e;
  }
  return data;
}

export function bolehNulis(role) {
  return role === "ADMIN" || role === "SOC_ANALYST";
}
export function bolehHapus(role) {
  return role === "ADMIN";
}
