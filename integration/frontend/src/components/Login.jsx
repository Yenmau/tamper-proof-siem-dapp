import { useState } from "react";

/**
 * Halaman LOGIN (authentication pakai wallet address).
 *
 * Tidak ada username/password: identitas = alamat wallet, dan "siapa dia"
 * ditentukan oleh role yang tersimpan di SMART CONTRACT. Jadi login di sini
 * benar-benar membaca state blockchain (getRoleName), bukan tabel di database.
 */
export default function Login({ config, onLogin, onSkip, notice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alamatManual, setAlamatManual] = useState("");

  async function masuk() {
    setBusy(true);
    setError("");
    try {
      const hasil = await onLogin();
      if (hasil?.error) setError(hasil.error);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function masukManual() {
    setBusy(true);
    setError("");
    try {
      const hasil = await onLogin({ alamat: alamatManual.trim() });
      if (hasil?.error) setError(hasil.error);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-6 text-slate-200">
      <div className="rounded-lg border border-soc-line bg-soc-panel p-6">
        <h1 className="text-2xl font-semibold text-slate-100">🛡️ Tamper-Proof SIEM</h1>
        <p className="mt-1 text-sm text-slate-400">
          Login memakai <span className="font-mono text-slate-300">wallet address</span> · {config?.networkName || "—"} · chainId{" "}
          {config?.chainId ?? "—"}
        </p>

        <div className="mt-5 rounded border border-soc-line bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-400">
          <p className="mb-2 text-slate-300">Cara login:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Klik <span className="text-sky-300">Login dengan Wallet</span> — MetaMask akan meminta izin membuka alamat kamu (tidak ada biaya gas).</li>
            <li>Dashboard memanggil kontrak <span className="font-mono">getRoleName(alamat)</span> untuk tahu role kamu.</li>
            <li>Alamat tanpa role (<span className="font-mono">NONE</span>) akan ditolak — tidak ada akses tulis.</li>
          </ol>
          <p className="mt-3 text-slate-500">
            Otoritas tersimpan on-chain, bukan di database: <span className="font-mono">ADMIN</span> (semua),{" "}
            <span className="font-mono">SOC_ANALYST</span> (tambah/ubah aset &amp; log), <span className="font-mono">AUDITOR</span> (baca saja).
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={masuk}
            disabled={busy}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "menghubungi wallet…" : "Login dengan Wallet"}
          </button>
          <button
            onClick={onSkip}
            className="rounded border border-soc-line px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            masuk tanpa wallet (hanya-baca)
          </button>
        </div>

        <div className="mt-4 rounded border border-soc-line bg-slate-900/40 p-3">
          <p className="text-xs text-slate-400">
            Tidak punya MetaMask? Tempel alamat publik untuk masuk mode <span className="text-slate-200">hanya-baca</span> (role
            dibaca dari kontrak, tanpa tanda tangan):
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={alamatManual}
              onChange={(e) => setAlamatManual(e.target.value)}
              placeholder="0x…"
              className="w-80 rounded border border-soc-line bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-sky-600"
            />
            <button
              onClick={masukManual}
              disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(alamatManual.trim())}
              className="rounded border border-sky-700 px-3 py-1 text-xs text-sky-300 hover:bg-sky-900/40 disabled:opacity-40"
            >
              masuk sebagai alamat ini
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Mode ini tidak bisa menulis apa pun (tidak ada private key untuk tanda tangan / transaksi).
          </p>
        </div>

        {notice && <p className="mt-4 rounded border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">{notice}</p>}
        {error && <p className="mt-4 rounded border border-red-800/60 bg-red-950/40 p-3 text-xs text-red-200">{error}</p>}
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        Private key tidak pernah dikirim keluar browser. Tanda tangan dipakai untuk membuktikan alamat, bukan untuk menyimpan rahasia.
      </p>
    </main>
  );
}
