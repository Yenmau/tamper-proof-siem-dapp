import { JsonRpcProvider, BrowserProvider, Contract } from "ethers";

// ABI sepotong — hanya yang dipakai dashboard (baca + tulis aset + event).
export const ABI = [
  "function VERSION() view returns (string)",
  "function roles(address) view returns (uint8)",
  "function getRoleName(address) view returns (string)",
  "function canManageAssets(address) view returns (bool)",
  "function getLogCount() view returns (uint256)",
  "function getLogIdAt(uint256) view returns (string)",
  "function getLogEntry(string _logId) view returns (string logHash, uint256 timestamp, uint64 verifiedAt, bool isTampered, address recordedBy)",
  "function getLogStatus(string _logId) view returns (string, uint256, bool)",
  "function verifyLogIntegrityView(string _logId, string _currentHash) view returns (bool)",
  // --- registry aset (v4.0): CRUD penuh, log tetap immutable ---
  "function createAsset(string _assetId, string _name, string _category, string _location)",
  "function updateAsset(string _assetId, string _name, string _category, string _location)",
  "function deleteAsset(string _assetId)",
  "function getAsset(string _assetId) view returns (string name, string category, string location, uint64 createdAt, uint64 updatedAt, address createdBy, address updatedBy)",
  "function assetExists(string _assetId) view returns (bool)",
  "function getAssetCount() view returns (uint256)",
  "function getAssetIdAt(uint256 _index) view returns (string)",
  "event AssetCreated(string assetId, string name, string category, address by, uint256 timestamp)",
  "event AssetUpdated(string assetId, string name, string category, address by, uint256 timestamp)",
  "event AssetDeleted(string assetId, address by, uint256 timestamp)",
  "event TamperingDetected(string logId, string expectedHash, string actualHash)",
  "event LogRecorded(string logId, string logHash, uint256 timestamp)",
  "event LogVerified(string logId, string currentHash, bool isMatch, uint256 timestamp)",
];

/** Provider HANYA-BACA: dashboard tetap jalan tanpa MetaMask. */
export function makeReadOnly(rpcUrl, address) {
  const provider = new JsonRpcProvider(rpcUrl);
  return { provider, contract: new Contract(address, ABI, provider), kind: "readonly" };
}

/**
 * LOGIN: pakai MetaMask. Mengembalikan koneksi dengan dua wajah:
 *   - `read`     : kontrak lewat provider (gratis, untuk polling tabel)
 *   - `write`    : kontrak lewat signer (untuk createAsset/updateAsset/deleteAsset)
 * Keduanya memakai alamat kontrak & ABI yang sama.
 */
export async function connectWallet(address) {
  if (!window.ethereum) throw new Error("MetaMask tidak terpasang di browser ini");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const net = await provider.getNetwork();
  return {
    provider,
    signer,
    net,
    read: new Contract(address, ABI, provider),
    write: new Contract(address, ABI, signer),
    kind: "wallet",
  };
}

/** Registry aset on-chain (v4.0). */
export async function readAssets(contract) {
  const count = Number(await contract.getAssetCount());
  const rows = [];
  for (let i = 0; i < count; i++) {
    const assetId = await contract.getAssetIdAt(i);
    const a = await contract.getAsset(assetId);
    rows.push({
      assetId,
      name: a[0],
      category: a[1],
      location: a[2],
      createdAt: Number(a[3]),
      updatedAt: Number(a[4]),
      createdBy: a[5],
      updatedBy: a[6],
    });
  }
  return rows;
}

/** Apakah akun ini boleh create/update aset (ADMIN atau SOC_ANALYST)? */
export async function canManageAssets(contract, address) {
  try {
    return await contract.canManageAssets(address);
  } catch (_) {
    return false;
  }
}

export async function readRegistry(contract) {
  const count = Number(await contract.getLogCount());
  const rows = [];
  for (let i = 0; i < count; i++) {
    const logId = await contract.getLogIdAt(i);
    const e = await contract.getLogEntry(logId);
    rows.push({
      logId,
      hash: e[0],
      timestamp: Number(e[1]),
      verifiedAt: Number(e[2]),
      isTampered: e[3],
      recordedBy: e[4],
    });
  }
  return rows;
}

export async function readRole(contract, address) {
  try {
    return await contract.getRoleName(address);
  } catch (_) {
    return "?";
  }
}
