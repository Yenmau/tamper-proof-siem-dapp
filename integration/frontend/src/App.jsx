import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import StatCards from "./components/StatCards.jsx";
import LogTable from "./components/LogTable.jsx";
import LogDetail from "./components/LogDetail.jsx";
import AlarmBanner from "./components/AlarmBanner.jsx";
import EventStream from "./components/EventStream.jsx";
import Login from "./components/Login.jsx";
import AssetsPanel from "./components/AssetsPanel.jsx";
import UsersPanel from "./components/UsersPanel.jsx";
import { loadConfig, saveContractAddress, isAddress } from "./lib/config.js";
import { connectWallet, makeReadOnly, readRegistry, readRole } from "./lib/contract.js";

export default function App() {
  const [config, setConfig] = useState(null);
  const [contract, setContract] = useState(null);
  const [versiKontrak, setVersiKontrak] = useState(null);
  const [session, setSession] = useState(null); // { mode, addr, role, read, write, signer }
  const [tab, setTab] = useState("dashboard");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [alarm, setAlarm] = useState(null);
  const [alarmCount, setAlarmCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [onlyTampered, setOnlyTampered] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const listeners = useRef([]);

  const pushEvent = (kind, text) => setEvents((prev) => [{ kind, text, at: Math.floor(Date.now() / 1000) }, ...prev].slice(0, 100));

  // 1. muat konfigurasi runtime
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  // 2. koneksi HANYA-BACA untuk tabel log + listener event (jalan tanpa wallet).
  //    Login wallet hanya dibutuhkan untuk menulis, bukan untuk mengawasi.
  useEffect(() => {
    if (!config || !isAddress(config.contractAddress)) return;
    let alive = true;
    let timer = null;

    const { contract: c } = makeReadOnly(config.rpcUrl, config.contractAddress);
    setContract(c);
    pushEvent("info", `terhubung ke ${config.rpcUrl} · kontrak ${config.contractAddress}`);

    // versi kontrak (VERSION()) — ditampilkan di header, diambil satu kali
    c.VERSION()
      .then((v) => alive && setVersiKontrak(v))
      .catch(() => alive && setVersiKontrak(null));

    const refresh = async () => {
      setBusy(true);
      try {
        const data = await readRegistry(c);
        if (!alive) return;
        setRows(data);
        setError("");
        setLastRefresh(new Date());
      } catch (err) {
        if (alive) setError(err.shortMessage || err.message || String(err));
      } finally {
        if (alive) setBusy(false);
      }
    };
    refresh();
    timer = setInterval(refresh, Math.max(3, Number(config.pollSeconds) || 10) * 1000);

    const onTamper = (logId, expectedHash, actualHash) => {
      setAlarm({ logId, expectedHash, actualHash });
      setAlarmCount((n) => n + 1);
      pushEvent("bad", `🚨 TamperingDetected — ${logId}`);
    };
    const onRecorded = (logId) => pushEvent("ok", `LogRecorded — ${logId}`);
    const onVerified = (logId, _hash, isMatch) =>
      pushEvent(isMatch ? "info" : "bad", `LogVerified — ${logId} (${isMatch ? "cocok" : "TIDAK cocok"})`);
    const onAsset = (nama) => (id, _n, _c, oleh) => pushEvent("info", `${nama} — ${id} (oleh ${oleh.slice(0, 8)}…)`);
    const onAssetCreated = onAsset("AssetCreated");
    const onAssetUpdated = onAsset("AssetUpdated");
    const onAssetDeleted = (id, oleh) => pushEvent("info", `AssetDeleted — ${id} (oleh ${oleh.slice(0, 8)}…)`);
    c.on("TamperingDetected", onTamper);
    c.on("LogRecorded", onRecorded);
    c.on("LogVerified", onVerified);
    c.on("AssetCreated", onAssetCreated);
    c.on("AssetUpdated", onAssetUpdated);
    c.on("AssetDeleted", onAssetDeleted);
    listeners.current = [
      ["TamperingDetected", onTamper],
      ["LogRecorded", onRecorded],
      ["LogVerified", onVerified],
      ["AssetCreated", onAssetCreated],
      ["AssetUpdated", onAssetUpdated],
      ["AssetDeleted", onAssetDeleted],
    ];

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      try {
        listeners.current.forEach(([nama, fn]) => c.off(nama, fn));
      } catch (_) {
        /* provider sudah tutup */
      }
    };
  }, [config]);

  // 3. judul tab berkedip selama alarm belum ditutup
  useEffect(() => {
    if (!alarm) {
      document.title = "SOC Dashboard — Tamper-Proof SIEM";
      return;
    }
    let flip = false;
    const t = setInterval(() => {
      flip = !flip;
      document.title = flip ? "🚨 TAMPERING — SOC Dashboard" : "SOC Dashboard — Tamper-Proof SIEM";
    }, 800);
    return () => clearInterval(t);
  }, [alarm]);

  const stats = useMemo(() => {
    const tampered = rows.filter((r) => r.isTampered).length;
    return { total: rows.length, tampered, safe: rows.length - tampered, alarms: alarmCount };
  }, [rows, alarmCount]);

  const selectedEntry = useMemo(() => rows.find((r) => r.logId === selected) || null, [rows, selected]);

  function exportCsv() {
    const head = ["logId", "hash", "timestamp", "verifiedAt", "isTampered", "recordedBy"];
    const body = rows.map((r) => [r.logId, r.hash, r.timestamp, r.verifiedAt, r.isTampered, r.recordedBy].join(","));
    const blob = new Blob([head.join(",") + "\n" + body.join("\n") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `siem-registry-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    pushEvent("info", `export ${rows.length} baris ke CSV`);
  }

  /**
   * LOGIN.
   *   - tanpa argumen: pakai MetaMask (bisa kirim transaksi & tanda tangan)
   *   - { alamat }: masuk hanya-baca sebagai alamat itu (role tetap dibaca dari kontrak)
   * Alamat tanpa role apa pun (NONE) ditolak, kecuali untuk mode hanya-baca.
   */
  async function onLogin({ alamat } = {}) {
    setError("");
    if (!isAddress(config.contractAddress)) return { error: "Alamat kontrak belum di-set." };

    // --- mode hanya-baca dengan alamat manual ---
    if (alamat) {
      if (!isAddress(alamat)) return { error: "Alamat tidak valid (format 0x + 40 hex)." };
      const { contract: c } = makeReadOnly(config.rpcUrl, config.contractAddress);
      const role = await readRole(c, alamat);
      setSession({ mode: "readonly", addr: alamat, role, read: c, write: null, signer: null });
      pushEvent("info", `masuk hanya-baca sebagai ${alamat} (role ${role})`);
      return { ok: true };
    }

    // --- mode wallet (MetaMask) ---
    if (!window.ethereum) {
      return { error: "MetaMask tidak terdeteksi. Pakai tombol 'masuk tanpa wallet' atau pasang MetaMask." };
    }
    try {
      const { provider, signer, read, write, net } = await connectWallet(config.contractAddress);
      const addr = await signer.getAddress();
      const role = await readRole(read, addr);
      if (role === "NONE") {
        return {
          error: `Alamat ${addr} tidak punya role di kontrak (NONE). Minta ADMIN memanggil addAnalyst/addAuditor dulu.`,
        };
      }
      setSession({ mode: "wallet", addr, role, read, write, signer });
      pushEvent("info", `login wallet ${addr} · role ${role} · chain ${net.chainId}`);
      return { ok: true };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  }

  function logout() {
    pushEvent("info", "logout");
    setSession(null);
    setTab("dashboard");
  }

  if (!config) return <main className="p-8 text-slate-400">memuat konfigurasi…</main>;

  // Belum login -> halaman login (authentication pakai wallet address)
  if (!session) {
    return (
      <Login
        config={config}
        onLogin={onLogin}
        onSkip={() => {
          // Registry aset tetap bisa dibaca tanpa login: pakai koneksi hanya-baca yang
          // sudah dibuat di useEffect di atas. Kalau `read` null, tabel aset selalu
          // tampil "0 aset" padahal datanya ada on-chain.
          setSession({ mode: "readonly", addr: null, role: "PUBLIK", read: contract, write: null, signer: null });
          pushEvent("info", "masuk tanpa login (hanya-baca)");
        }}
        notice={error || undefined}
      />
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6 text-slate-200">
      <AlarmBanner alarm={alarm} onDismiss={() => setAlarm(null)} />
      <Header
        config={{ ...config, version: versiKontrak }}
        session={session}
        tab={tab}
        setTab={setTab}
        onSetAddress={(addr) => {
          saveContractAddress(addr);
          setConfig({ ...config, contractAddress: addr });
        }}
        onLogin={() => {
          setSession(null);
          setError("");
        }}
        onLogout={logout}
        onRefresh={() => setConfig({ ...config })}
        busy={busy}
        lastRefresh={lastRefresh}
      />

      {error && <p className="mb-4 rounded border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200">RPC error: {error}</p>}

      {session.mode === "readonly" && (
        <p className="mb-4 rounded border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          Mode hanya-baca: tabel &amp; alarm tetap jalan (data on-chain publik), tapi create/update/delete mati. Login dengan MetaMask
          memakai akun ber-role ADMIN / SOC_ANALYST untuk mengubah data.
        </p>
      )}

      {tab === "dashboard" && (
        <>
          <StatCards stats={stats} />
          <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <LogTable
                rows={rows}
                selected={selected}
                onSelect={setSelected}
                filter={filter}
                setFilter={setFilter}
                onlyTampered={onlyTampered}
                setOnlyTampered={setOnlyTampered}
                onExport={exportCsv}
              />
              <div className="mt-5">
                <EventStream events={events} />
              </div>
            </div>
            <div className="lg:col-span-2">
              <LogDetail entry={selectedEntry} config={config} contract={contract} onEvent={pushEvent} />
            </div>
          </div>
        </>
      )}

      {tab === "aset" && <AssetsPanel session={session} onEvent={pushEvent} />}
      {tab === "user" && <UsersPanel config={config} session={session} onEvent={pushEvent} />}

      <footer className="mt-8 border-t border-soc-line pt-4 text-xs text-slate-500">
        Login wallet → role dibaca dari kontrak (<span className="font-mono">getRoleName</span>) · data aset on-chain, data user
        off-chain (MongoDB) · ABI dari <span className="font-mono">contracts/SIEMLogger.json</span> · dashboard tidak pernah memegang
        private key.
      </footer>
    </main>
  );
}
