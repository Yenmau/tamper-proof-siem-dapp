import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import StatCards from "./components/StatCards.jsx";
import LogTable from "./components/LogTable.jsx";
import LogDetail from "./components/LogDetail.jsx";
import AlarmBanner from "./components/AlarmBanner.jsx";
import EventStream from "./components/EventStream.jsx";
import { loadConfig, saveContractAddress, isAddress } from "./lib/config.js";
import { connectWallet, makeReadOnly, readRegistry, readRole } from "./lib/contract.js";

export default function App() {
  const [config, setConfig] = useState(null);
  const [contract, setContract] = useState(null);
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
  const [wallet, setWallet] = useState({ addr: null, role: null });
  const listeners = useRef([]);

  const pushEvent = (kind, text) => setEvents((prev) => [{ kind, text, at: Math.floor(Date.now() / 1000) }, ...prev].slice(0, 100));

  // 1. muat konfigurasi runtime
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  // 2. siapkan koneksi hanya-baca + polling + listener event
  useEffect(() => {
    if (!config || !isAddress(config.contractAddress)) return;
    let alive = true;
    let timer = null;

    const { contract: c } = makeReadOnly(config.rpcUrl, config.contractAddress);
    setContract(c);
    pushEvent("info", `terhubung ke ${config.rpcUrl} · kontrak ${config.contractAddress}`);

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

    // event real-time: ini yang menyalakan alarm
    const onTamper = (logId, expectedHash, actualHash) => {
      setAlarm({ logId, expectedHash, actualHash });
      setAlarmCount((n) => n + 1);
      pushEvent("bad", `🚨 TamperingDetected — ${logId}`);
    };
    const onRecorded = (logId) => pushEvent("ok", `LogRecorded — ${logId}`);
    const onVerified = (logId, _hash, isMatch) => pushEvent(isMatch ? "info" : "bad", `LogVerified — ${logId} (${isMatch ? "cocok" : "TIDAK cocok"})`);
    c.on("TamperingDetected", onTamper);
    c.on("LogRecorded", onRecorded);
    c.on("LogVerified", onVerified);
    listeners.current = [c, onTamper, onRecorded, onVerified];

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      try {
        c.off("TamperingDetected", onTamper);
        c.off("LogRecorded", onRecorded);
        c.off("LogVerified", onVerified);
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

  async function onConnect() {
    try {
      const { provider, contract: c, signer } = await connectWallet(config.contractAddress);
      const addr = await signer.getAddress();
      const net = await provider.getNetwork();
      const role = await readRole(c, addr);
      setWallet({ addr, role });
      pushEvent("info", `wallet ${addr} (${role}) di chain ${net.chainId}`);
    } catch (err) {
      pushEvent("bad", `connect wallet gagal: ${err.message || err}`);
    }
  }

  if (!config) return <main className="p-8 text-slate-400">memuat konfigurasi…</main>;

  return (
    <main className="mx-auto max-w-7xl p-6 text-slate-200">
      <AlarmBanner alarm={alarm} onDismiss={() => setAlarm(null)} />
      <Header
        config={config}
        onSetAddress={(addr) => {
          saveContractAddress(addr);
          setConfig({ ...config, contractAddress: addr });
        }}
        walletAddr={wallet.addr}
        role={wallet.role}
        onConnect={onConnect}
        onRefresh={() => setConfig({ ...config })}
        busy={busy}
        lastRefresh={lastRefresh}
      />

      {error && <p className="mb-4 rounded border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200">RPC error: {error}</p>}

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

      <footer className="mt-8 border-t border-soc-line pt-4 text-xs text-slate-500">
        Tim #5 (SOC Dashboard) · React + Vite + Tailwind · ABI & event dari <span className="font-mono">contracts/SIEMLogger.json</span>. Alarm muncul dari event{" "}
        <span className="font-mono">TamperingDetected</span>; dashboard tidak pernah memegang private key.
      </footer>
    </main>
  );
}
