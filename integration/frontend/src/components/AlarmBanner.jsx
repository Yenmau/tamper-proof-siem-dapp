import { shortHash } from "../lib/format.js";

export default function AlarmBanner({ alarm, onDismiss }) {
  if (!alarm) return null;
  return (
    <div className="alarm-on mb-5 rounded border border-red-500/60 bg-red-950/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-bold text-red-300">🚨 TAMPERING DETECTED</p>
          <p className="font-mono text-sm text-red-200">{alarm.logId}</p>
          <p className="mt-1 break-all font-mono text-xs text-red-300/80">
            hash asli : {shortHash(alarm.expectedHash, 18, 12)}
            <br />
            hash server: {shortHash(alarm.actualHash, 18, 12)}
          </p>
        </div>
        <button onClick={onDismiss} className="rounded border border-red-500/60 px-2 py-1 text-xs text-red-200 hover:bg-red-900/50">
          tutup
        </button>
      </div>
    </div>
  );
}
