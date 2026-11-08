import { JsonRpcProvider, BrowserProvider, Contract } from "ethers";

// ABI sepotong — hanya yang dipakai dashboard (pembacaan + 1 event).
export const ABI = [
  "function roles(address) view returns (uint8)",
  "function getRoleName(address) view returns (string)",
  "function getLogCount() view returns (uint256)",
  "function getLogIdAt(uint256) view returns (string)",
  "function getLogEntry(string _logId) view returns (string logHash, uint256 timestamp, uint64 verifiedAt, bool isTampered, address recordedBy)",
  "function getLogStatus(string _logId) view returns (string, uint256, bool)",
  "function verifyLogIntegrityView(string _logId, string _currentHash) view returns (bool)",
  "event TamperingDetected(string logId, string expectedHash, string actualHash)",
  "event LogRecorded(string logId, string logHash, uint256 timestamp)",
  "event LogVerified(string logId, string currentHash, bool isMatch, uint256 timestamp)",
];

/** Provider HANYA-BACA: dashboard tetap jalan tanpa MetaMask. */
export function makeReadOnly(rpcUrl, address) {
  const provider = new JsonRpcProvider(rpcUrl);
  return { provider, contract: new Contract(address, ABI, provider), kind: "readonly" };
}

/** Opsional: pakai MetaMask untuk menampilkan role akun yang connect. */
export async function connectWallet(address) {
  if (!window.ethereum) throw new Error("MetaMask tidak terpasang di browser ini");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { provider, contract: new Contract(address, ABI, provider), signer, kind: "wallet" };
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
