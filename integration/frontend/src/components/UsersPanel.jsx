import { useCallback, useEffect, useState } from "react";
import { apiFetch, bolehHapus, bolehNulis } from "../lib/wallet.js";
import { fmtTime, shortAddr } from "../lib/format.js";

const KOSONG = { walletAddress: "", name: "", email: "", department: "", team: "Blue Team", notes: "" };

/**
 * DATA USER (OFF-CHAIN) — "Off-chain State Management" di MongoDB.
 *
 *   INSERT : POST   /api/users
 *   VIEW   : GET    /api/users, /api/users/:wallet
 *   UPDATE : PUT    /api/users/:wallet
 *   DELETE : DELETE /api/users/:wallet   (hanya ADMIN)
 *
 * Kenapa off-chain? Nama, email, dan data pribadi tidak layak disimpan di
 * blockchain: mahal (gas) dan terbuka untuk siapa saja. Yang tetap on-chain
 * adalah pembuktian integritas (hash log), registry aset, dan ROLE akun —
 * jadi otorisasi di sini tetap membaca kebenaran dari kontrak, bukan dari
 * database. Setiap request ditandatangani wallet (personal_sign) supaya API
 * tahu siapa yang memanggil.
 */
export default function UsersPanel({ config, session, onEvent }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(KOSONG);
  const [mode, setMode] = useState("create");
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState(null);
  const [q, setQ] = useState("");

  const role = session?.role || "NONE";
  const signer = session?.signer;
  const bolehTulis = Boolean(signer) && bolehNulis(role);
  const bolehDelete = Boolean(signer) && bolehHapus(role);

  const muat = useCallback(async () => {
    if (!signer) return;
    try {
      const res = await apiFetch(config, signer, "GET", `/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setRows(res.data || []);
      setPesan(null);
    } catch (err) {
      setPesan({ kind: "bad", text: `${err.message}${err.detail ? ` — ${err.detail}` : ""}` });
    }
  }, [config, signer, q]);

  useEffect(() => {
    muat();
    const t = setInterval(muat, 15000);
    return () => clearInterval(t);
  }, [muat]);

  async function kirim(e) {
    e.preventDefault();
    if (!bolehTulis) return;
    if (!form.walletAddress || !form.name || !form.email) {
      setPesan({ kind: "bad", text: "walletAddress, nama, dan email wajib diisi" });
      return;
    }
    setBusy(true);
    setPesan(null);
    try {
      if (mode === "create") {
        await apiFetch(config, signer, "POST", "/api/users", form);
        setPesan({ kind: "ok", text: `user ${form.name} ditambahkan ke MongoDB (off-chain)` });
        onEvent?.("ok", `INSERT user off-chain — ${shortAddr(form.walletAddress)}`);
      } else {
        const { walletAddress, ...ubah } = form;
        await apiFetch(config, signer, "PUT", `/api/users/${walletAddress}`, ubah);
        setPesan({ kind: "ok", text: `user ${walletAddress} diperbarui` });
        onEvent?.("ok", `UPDATE user off-chain — ${shortAddr(walletAddress)}`);
      }
      setForm(KOSONG);
      setMode("create");
      muat();
    } catch (err) {
      setPesan({ kind: "bad", text: `${err.message}${err.detail ? ` — ${err.detail}` : ""}` });
    } finally {
      setBusy(false);
    }
  }

  async function hapus(wallet) {
    if (!bolehDelete) return;
    setBusy(true);
    setPesan(null);
    try {
      await apiFetch(config, signer, "DELETE", `/api/users/${wallet}`);
      setPesan({ kind: "ok", text: `user ${wallet} dihapus dari MongoDB` });
      onEvent?.("ok", `DELETE user off-chain — ${shortAddr(wallet)}`);
      muat();
    } catch (err) {
      setPesan({ kind: "bad", text: `${err.message}${err.detail ? ` — ${err.detail}` : ""}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="rounded border border-soc-line bg-soc-panel p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-xs uppercase tracking-wide text-slate-400">Data user off-chain (MongoDB)</h2>
            <span className="rounded border border-soc-line px-2 py-0.5 font-mono text-[11px] text-slate-400">{rows.length} user</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="cari nama / email / wallet…"
              className="ml-auto w-48 rounded border border-soc-line bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
            />
            <button onClick={muat} className="rounded border border-soc-line px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
              refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr className="border-b border-soc-line">
                  <th className="py-2 pr-3">wallet</th>
                  <th className="py-2 pr-3">nama</th>
                  <th className="py-2 pr-3">email</th>
                  <th className="py-2 pr-3">departemen</th>
                  <th className="py-2 pr-3">tim</th>
                  <th className="py-2 pr-3">status</th>
                  <th className="py-2 pr-3">diubah</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-slate-500">
                      {signer ? "belum ada data user off-chain" : "login dengan wallet untuk melihat data ini"}
                    </td>
                  </tr>
                )}
                {rows.map((u) => (
                  <tr key={u.walletAddress} className="border-b border-soc-line/60 hover:bg-slate-800/30">
                    <td className="py-2 pr-3 font-mono text-slate-400">{shortAddr(u.walletAddress)}</td>
                    <td className="py-2 pr-3 text-slate-200">{u.name}</td>
                    <td className="py-2 pr-3 text-slate-400">{u.email}</td>
                    <td className="py-2 pr-3 text-slate-400">{u.department || "-"}</td>
                    <td className="py-2 pr-3 text-slate-400">{u.team || "-"}</td>
                    <td className="py-2 pr-3">
                      <span className={u.active ? "text-emerald-300" : "text-amber-300"}>{u.active ? "aktif" : "nonaktif"}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{u.updatedAt ? fmtTime(Math.floor(new Date(u.updatedAt).getTime() / 1000)) : "-"}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          disabled={!bolehTulis || busy}
                          onClick={() => {
                            setForm({
                              walletAddress: u.walletAddress,
                              name: u.name,
                              email: u.email,
                              department: u.department || "",
                              team: u.team || "",
                              notes: u.notes || "",
                            });
                            setMode("edit");
                          }}
                          className="rounded border border-sky-800/60 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-900/40 disabled:opacity-30"
                          title={bolehTulis ? "muat ke form untuk diubah" : "butuh role ADMIN / SOC_ANALYST"}
                        >
                          ubah
                        </button>
                        <button
                          disabled={!bolehDelete || busy}
                          onClick={() => hapus(u.walletAddress)}
                          className="rounded border border-red-900/60 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/40 disabled:opacity-30"
                          title={bolehDelete ? "hapus user (ADMIN)" : "hanya ADMIN yang boleh menghapus"}
                        >
                          hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        <form onSubmit={kirim} className="rounded border border-soc-line bg-soc-panel p-4">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-slate-400">
            {mode === "create" ? "Tambah user (INSERT)" : "Ubah user (UPDATE)"}
          </h2>

          {[
            ["walletAddress", "wallet address (0x…)"],
            ["name", "nama lengkap"],
            ["email", "email"],
            ["department", "departemen"],
            ["team", "tim"],
            ["notes", "catatan"],
          ].map(([k, label]) => (
            <label key={k} className="mb-2 block">
              <span className="mb-1 block text-[11px] text-slate-500">{label}</span>
              <input
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                disabled={(k === "walletAddress" && mode === "edit") || !bolehTulis}
                placeholder={label}
                className="w-full rounded border border-soc-line bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-sky-600 disabled:opacity-50"
              />
            </label>
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!bolehTulis || busy}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {busy ? "mengirim…" : mode === "create" ? "Tambah user" : "Simpan perubahan"}
            </button>
            {mode === "edit" && (
              <button
                type="button"
                onClick={() => {
                  setForm(KOSONG);
                  setMode("create");
                }}
                className="rounded border border-soc-line px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                batal
              </button>
            )}
          </div>

          {!signer && (
            <p className="mt-3 text-[11px] text-amber-300">
              Mode hanya-baca: API off-chain butuh tanda tangan wallet, jadi tabel ini kosong sampai kamu login.
            </p>
          )}
          {signer && !bolehTulis && (
            <p className="mt-3 text-[11px] text-amber-300">
              Role kamu <span className="font-mono">{role}</span> — boleh membaca, tidak boleh menulis.
            </p>
          )}
          {pesan && (
            <p
              className={`mt-3 rounded border p-2 text-[11px] ${
                pesan.kind === "bad"
                  ? "border-red-800/60 bg-red-950/40 text-red-200"
                  : pesan.kind === "ok"
                    ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200"
                    : "border-soc-line bg-slate-900/40 text-slate-300"
              }`}
            >
              {pesan.text}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Setiap request ditandatangani (<span className="font-mono">personal_sign</span>) dan server memeriksa ulang role kamu ke
            kontrak. Tanda tangan sekali pakai: pesannya memuat timestamp + nonce, jadi tidak bisa di-<em>replay</em>.
          </p>
        </form>
      </div>
    </section>
  );
}
