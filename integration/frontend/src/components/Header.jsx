import { useState } from "react";
import { isAddress } from "../lib/config.js";
import { shortAddr } from "../lib/format.js";

export default function Header({ config, onSetAddress, walletAddr, role, onConnect, onRefresh, busy, lastRefresh }) {
  const [draft, setDraft] = useState("");
  return (
    <header className="mb-6 border-b border-soc-line pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-100">🛡️ SOC Dashboard</h1>
        <span className="rounded border border-soc-line bg-soc-panel px-2 py-0.5 font-mono text-xs text-slate-400">
          {config.networkName} · chainId {config.chainId}
        </span>
        <span className="rounded border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-300">
          mode hanya-baca (tanpa MetaMask)
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span>{lastRefresh ? `refresh ${lastRefresh.toLocaleTimeString("id-ID")}` : "belum refresh"}</span>
          <button onClick={onRefresh} disabled={busy} className="rounded border border-soc-line px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            {busy ? "memuat…" : "refresh"}
          </button>
          {walletAddr ? (
            <span className="rounded border border-sky-800/60 bg-sky-950/40 px-2 py-1 font-mono text-sky-300">
              {shortAddr(walletAddr)} · {role}
            </span>
          ) : (
            <button onClick={onConnect} className="rounded border border-sky-700 px-2 py-1 text-sky-300 hover:bg-sky-900/40">
              connect wallet (opsional)
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
        <span>kontrak:</span>
        <span className="text-slate-200">{config.contractAddress || "(belum di-set)"}</span>
        <span>· RPC: {config.rpcUrl}</span>
        <span>· data: {config.dataPath}</span>
      </p>

      {!isAddress(config.contractAddress) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          <span>Alamat kontrak belum di-set. Tempel alamat kontrak (lihat `deployments.json` atau output `scripts/deploy.js`):</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="0x…"
            className="w-80 rounded border border-soc-line bg-slate-900 px-2 py-1 font-mono text-slate-200 outline-none focus:border-amber-600"
          />
          <button
            onClick={() => isAddress(draft.trim()) && onSetAddress(draft.trim())}
            disabled={!isAddress(draft.trim())}
            className="rounded border border-amber-600 px-2 py-1 text-amber-100 hover:bg-amber-900/40 disabled:opacity-40"
          >
            pakai alamat ini
          </button>
        </div>
      )}
    </header>
  );
}
