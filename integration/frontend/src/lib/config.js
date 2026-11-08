// Konfigurasi runtime: dibaca dari /config.json (ditulis saat container start),
// bisa ditimpa alamat kontrak dari localStorage untuk kerja lokal tanpa compose.
export const DEFAULT_CONFIG = {
  rpcUrl: "http://127.0.0.1:8545",
  contractAddress: "",
  chainId: 31337,
  networkName: "Hardhat lokal",
  pollSeconds: 10,
  dataPath: "/data",
};

const LS_KEY = "siem.contractAddress";

export async function loadConfig() {
  let fromFile = {};
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (res.ok) fromFile = await res.json();
  } catch (_) {
    /* config.json tidak ada (mode dev) -> pakai default */
  }
  const override = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  const cfg = { ...DEFAULT_CONFIG, ...fromFile };
  if (override) cfg.contractAddress = override;
  return cfg;
}

export function saveContractAddress(address) {
  try {
    if (address) localStorage.setItem(LS_KEY, address);
    else localStorage.removeItem(LS_KEY);
  } catch (_) {
    /* localStorage bisa diblokir; abaikan */
  }
}

export const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
