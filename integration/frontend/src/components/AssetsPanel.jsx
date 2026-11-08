import { useCallback, useEffect, useState } from "react";
import { readAssets } from "../lib/contract.js";
import { bolehHapus, bolehNulis } from "../lib/wallet.js";
import { fmtTime, shortAddr } from "../lib/format.js";

const KOSONG = { assetId: "", name: "", category: "server", location: "" };

/**
 * REGISTRY ASET — "On-chain State Management" dengan CRUD penuh:
 *   INSERT : createAsset()   (ADMIN / SOC_ANALYST)
 *   VIEW   : getAssetIds() + getAsset()
 *   UPDATE : updateAsset()   (ADMIN / SOC_ANALYST)
 *   DELETE : deleteAsset()   (ADMIN saja)
 *
 * Berbeda dari registry log yang sengaja IMMUTABLE (hash-nya tidak boleh
 * ditimpa), data aset/inventaris memang berubah: pindah lokasi, ganti
 * kategori, atau dinonaktifkan. Setiap perubahan tetap meninggalkan jejak
 * permanen berupa event di blockchain.
 */
export default function AssetsPanel({ session, onEvent }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(KOSONG);
  const [mode, setMode] = useState("create"); // create | edit
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState(null); // { kind, text }
  const [q, setQ] = useState("");

  const role = session?.role || "NONE";
  const bolehUbah = session?.signer && bolehNulis(role);
  const bolehDelete = session?.signer && bolehHapus(role);
  const read = session?.read;
  const write = session?.write;

  const muat = useCallback(async () => {
    if (!read) return;
    try {
      setRows(await readAssets(read));
    } catch (err) {
      setPesan({ kind: "bad", text: `gagal membaca aset dari kontrak: ${err.shortMessage || err.message || err}` });
    }
  }, [read]);

  useEffect(() => {
    muat();
    const t = setInterval(muat, 12000);
    return () => clearInterval(t);
  }, [muat]);

  async function kirim(e) {
    e.preventDefault();
    if (!bolehUbah) return;
    if (!form.assetId || !form.name) {
      setPesan({ kind: "bad", text: "assetId dan nama wajib diisi" });
      return;
    }
    setBusy(true);
    setPesan(null);
    try {
      const fn = mode === "create" ? "createAsset" : "updateAsset";
      const tx = await write[fn](form.assetId, form.name, form.category || "", form.location || "");
      setPesan({ kind: "info", text: `${fn} dikirim… menunggu konfirmasi blok` });
      const rc = await tx.wait();
      setPesan({ kind: "ok", text: `${fn}(${form.assetId}) berhasil · blok terpakai ${rc.gasUsed.toString()} gas` });
      onEvent?.("ok", `aset ${mode === "create" ? "dibuat" : "diubah"} — ${form.assetId}`);
      setForm(KOSONG);
      setMode("create");
      muat();
    } catch (err) {
      setPesan({ kind: "bad", text: jelaskan(err) });
    } finally {
      setBusy(false);
    }
  }

  async function hapus(assetId) {
    if (!bolehDelete) return;
    setBusy(true);
    setPesan(null);
    try {
      const tx = await write.deleteAsset(assetId);
      const rc = await tx.wait();
      setPesan({ kind: "ok", text: `deleteAsset(${assetId}) berhasil · ${rc.gasUsed.toString()} gas` });
      onEvent?.("ok", `aset dihapus — ${assetId}`);
      muat();
    } catch (err) {
      setPesan({ kind: "bad", text: jelaskan(err) });
    } finally {
      setBusy(false);
    }
  }

  function jelaskan(err) {
    const alasan = err?.reason || err?.shortMessage || err?.message || String(err);
    if (/NotOperator/.test(alasan)) return "ditolak kontrak: role kamu tidak boleh menulis aset (butuh ADMIN / SOC_ANALYST).";
    if (/NotAdmin/.test(alasan)) return "ditolak kontrak: hanya ADMIN yang boleh menghapus aset.";
    if (/AssetAlreadyExists/.test(alasan)) return "assetId itu sudah terdaftar.";
    if (/AssetNotFound/.test(alasan)) return "aset tidak ditemukan (mungkin sudah dihapus orang lain).";
    if (/EmptyName/.test(alasan)) return "nama aset tidak boleh kosong.";
    return alasan;
  }

  const tampil = rows.filter((r) => {
    if (!q) return true;
    const s = `${r.assetId} ${r.name} ${r.category} ${r.location}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <section className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="rounded border border-soc-line bg-soc-panel p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-xs uppercase tracking-wide text-slate-400">Registry aset on-chain (CRUD)</h2>
            <span className="rounded border border-soc-line px-2 py-0.5 font-mono text-[11px] text-slate-400">{rows.length} aset</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="cari aset…"
              className="ml-auto w-40 rounded border border-soc-line bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
            />
            <button onClick={muat} className="rounded border border-soc-line px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
              refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr className="border-b border-soc-line">
                  <th className="py-2 pr-3">assetId</th>
                  <th className="py-2 pr-3">nama</th>
                  <th className="py-2 pr-3">kategori</th>
                  <th className="py-2 pr-3">lokasi</th>
                  <th className="py-2 pr-3">diubah</th>
                  <th className="py-2 pr-3">oleh</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {tampil.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-500">
                      belum ada aset{rows.length > 0 ? " yang cocok dengan pencarian" : ""}
                    </td>
                  </tr>
                )}
                {tampil.map((r) => (
                  <tr key={r.assetId} className="border-b border-soc-line/60 hover:bg-slate-800/30">
                    <td className="py-2 pr-3 font-mono text-slate-300">{r.assetId}</td>
                    <td className="py-2 pr-3 text-slate-200">{r.name}</td>
                    <td className="py-2 pr-3 text-slate-400">{r.category || "-"}</td>
                    <td className="py-2 pr-3 text-slate-400">{r.location || "-"}</td>
                    <td className="py-2 pr-3 text-slate-500">{fmtTime(r.updatedAt)}</td>
                    <td className="py-2 pr-3 font-mono text-slate-500">{shortAddr(r.updatedBy)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          disabled={!bolehUbah || busy}
                          onClick={() => {
                            setForm({ assetId: r.assetId, name: r.name, category: r.category, location: r.location });
                            setMode("edit");
                          }}
                          className="rounded border border-sky-800/60 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-900/40 disabled:opacity-30"
                          title={bolehUbah ? "muat ke form untuk diubah" : "butuh role ADMIN / SOC_ANALYST"}
                        >
                          ubah
                        </button>
                        <button
                          disabled={!bolehDelete || busy}
                          onClick={() => hapus(r.assetId)}
                          className="rounded border border-red-900/60 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/40 disabled:opacity-30"
                          title={bolehDelete ? "hapus aset (ADMIN)" : "hanya ADMIN yang boleh menghapus"}
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
            {mode === "create" ? "Tambah aset (INSERT)" : "Ubah aset (UPDATE)"}
          </h2>

          {[
            ["assetId", "assetId (kunci, mis. srv-01)"],
            ["name", "nama aset"],
            ["category", "kategori (server / database / endpoint)"],
            ["location", "lokasi / rack / hostname"],
          ].map(([k, label]) => (
            <label key={k} className="mb-2 block">
              <span className="mb-1 block text-[11px] text-slate-500">{label}</span>
              <input
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                disabled={k === "assetId" && mode === "edit"}
                placeholder={label}
                className="w-full rounded border border-soc-line bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-sky-600 disabled:opacity-50"
              />
            </label>
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!bolehUbah || busy}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {busy ? "mengirim transaksi…" : mode === "create" ? "Tambah aset" : "Simpan perubahan"}
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

          {!session?.signer && (
            <p className="mt-3 text-[11px] text-amber-300">
              Mode hanya-baca: tombol tulis mati. Login dengan MetaMask (role ADMIN / SOC_ANALYST) untuk memakai create / update / delete.
            </p>
          )}
          {session?.signer && !bolehUbah && (
            <p className="mt-3 text-[11px] text-amber-300">
              Role kamu <span className="font-mono">{role}</span> — auditor hanya boleh membaca (separasi tugas).
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
            Tidak ada fungsi update/delete untuk hash log — log sengaja immutable. CRUD hanya berlaku untuk data aset, dan setiap
            penghapusan tetap tercatat permanen sebagai event <span className="font-mono">AssetDeleted</span>.
          </p>
        </form>
      </div>
    </section>
  );
}
