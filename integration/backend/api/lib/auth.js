// integration/backend/api/lib/auth.js
//
// AUTHENTICATION "login pakai wallet address" untuk sisi OFF-CHAIN.
//
// Kenapa perlu lapisan ini kalau kontrak sudah punya RBAC?
// Karena endpoint API ini berjalan di luar blockchain: kalau siapa pun bisa
// memanggil `POST /api/users`, aturan role on-chain jadi tidak ada artinya.
// Jadi setiap permintaan tulis harus membuktikan dua hal:
//
//   1. Pemanggil benar-benar memegang private key dari alamat wallet itu
//      -> tanda tangan EIP-191 (`personal_sign`) atas sebuah pesan.
//   2. Alamat itu ber-role sesuai di KONTRAK (sumber kebenaran tetap on-chain)
//      -> panggil `getRoleName(address)` lewat RPC.
//
// Pesan yang ditandatangani memuat timestamp + nonce, supaya tanda tangan lama
// tidak bisa dipakai ulang (replay attack).

const { ethers } = require("ethers");

/** Batas umur tanda tangan (detik). */
const MAX_AGE_SEC = 300;

/** Matriks izin: tindakan -> role yang boleh (nama role on-chain). */
const ACTION_ROLES = {
  read: ["ADMIN", "SOC_ANALYST", "AUDITOR"],
  write: ["ADMIN", "SOC_ANALYST"],
  delete: ["ADMIN"],
};

// ---------------------------------------------------------------------------
// Bagian murni (tanpa jaringan) — diuji di test/api.test.js
// ---------------------------------------------------------------------------

/** Bangun pesan kanonik yang akan ditandatangani wallet. */
function buildMessage({ wallet, ts, nonce }) {
  return [
    "SIEM Off-Chain API",
    `wallet: ${String(wallet).toLowerCase()}`,
    `timestamp: ${ts}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/**
 * Pesan berisi baris baru, dan nilai HTTP header TIDAK boleh mengandung baris
 * baru -> pesan dikirim sebagai base64 di header `x-message`.
 */
function encodeMessage(message) {
  return Buffer.from(String(message), "utf8").toString("base64");
}

/** Kebalikan dari encodeMessage. null kalau isinya bukan base64 pesan yang sah. */
function decodeMessage(nilai) {
  if (typeof nilai !== "string" || nilai.length === 0) return null;
  try {
    const teks = Buffer.from(nilai, "base64").toString("utf8");
    return teks.includes("\n") ? teks : null;
  } catch (_) {
    return null;
  }
}

/** Baca kembali isi pesan. Mengembalikan null kalau formatnya tidak dikenal. */
function parseMessage(message) {
  if (typeof message !== "string") return null;
  const baris = message.split("\n").map((l) => l.trim());
  if (baris[0] !== "SIEM Off-Chain API") return null;
  const ambil = (prefix) => {
    const l = baris.find((x) => x.startsWith(prefix));
    return l ? l.slice(prefix.length).trim() : null;
  };
  const wallet = ambil("wallet:");
  const ts = ambil("timestamp:");
  const nonce = ambil("nonce:");
  if (!wallet || !ts || !nonce) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  if (!/^\d+$/.test(ts)) return null;
  return { wallet: wallet.toLowerCase(), ts: Number(ts), nonce };
}

/** Tanda tangan masih segar? (mencegah replay di kemudian hari) */
function isFresh(ts, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = MAX_AGE_SEC) {
  if (!Number.isFinite(ts)) return false;
  const umur = nowSec - ts;
  return umur >= -30 && umur <= maxAgeSec; // toleransi 30 dtk untuk jam yang bergeser
}

/** Apakah `roleName` boleh melakukan `action`? */
function roleAllows(action, roleName) {
  const boleh = ACTION_ROLES[action];
  if (!boleh) return false;
  return boleh.includes(String(roleName || "").toUpperCase());
}

/** Normalisasi alamat; mengembalikan null kalau bukan alamat yang sah. */
function normalizeWallet(addr) {
  try {
    return ethers.getAddress(String(addr)).toLowerCase();
  } catch (_) {
    return null;
  }
}

/**
 * Verifikasi tanda tangan. Mengembalikan { ok, reason, wallet } — tidak melempar,
 * supaya pemanggilnya mudah diuji dan pesan errornya konsisten.
 */
function verifySignature({ message, signature, wallet, nowSec }) {
  const parsed = parseMessage(message);
  if (!parsed) return { ok: false, reason: "format_pesan" };
  if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
    return { ok: false, reason: "tanda_tangan_kosong" };
  }

  const walletHeader = normalizeWallet(wallet);
  if (!walletHeader) return { ok: false, reason: "alamat_tidak_valid" };
  if (parsed.wallet !== walletHeader) return { ok: false, reason: "alamat_beda_dengan_pesan" };
  if (!isFresh(parsed.ts, nowSec)) return { ok: false, reason: "tanda_tangan_basi" };

  let pemulih;
  try {
    pemulih = ethers.verifyMessage(message, signature).toLowerCase();
  } catch (_) {
    return { ok: false, reason: "tanda_tangan_rusak" };
  }
  if (pemulih !== walletHeader) return { ok: false, reason: "pemilik_tidak_cocok" };

  return { ok: true, wallet: walletHeader, nonce: parsed.nonce, ts: parsed.ts };
}

// ---------------------------------------------------------------------------
// Nonce store — sekali pakai, kedaluwarsa otomatis
// ---------------------------------------------------------------------------

function createNonceStore({ maxAgeSec = MAX_AGE_SEC } = {}) {
  const dipakai = new Map(); // nonce -> ts

  function bersihkan(nowSec = Math.floor(Date.now() / 1000)) {
    for (const [nonce, ts] of dipakai) {
      if (nowSec - ts > maxAgeSec) dipakai.delete(nonce);
    }
  }

  return {
    /** true kalau nonce belum pernah dipakai (dan langsung menandainya terpakai). */
    pakai(nonce, ts) {
      bersihkan();
      if (dipakai.has(nonce)) return false;
      dipakai.set(nonce, ts || Math.floor(Date.now() / 1000));
      return true;
    },
    size: () => dipakai.size,
  };
}

// ---------------------------------------------------------------------------
// Middleware Express
// ---------------------------------------------------------------------------

/**
 * Buat middleware yang mewajibkan tanda tangan wallet + role on-chain.
 *
 * @param {"read"|"write"|"delete"} action
 * @param {object} opsi
 * @param {(addr:string)=>Promise<string>} opsi.roleOf  pembaca role on-chain
 * @param {object} opsi.nonceStore
 */
function requireWallet(action, { roleOf, nonceStore }) {
  return async function (req, res, next) {
    const wallet = req.get("x-wallet");
    const message = decodeMessage(req.get("x-message"));
    const signature = req.get("x-signature");

    if (!wallet || !message || !signature) {
      return res.status(401).json({
        error: "Butuh login wallet",
        detail:
          "Kirim header x-wallet, x-message (pesan di-encode base64), dan x-signature. Pesan ditandatangani lewat personal_sign.",
        formatPesan: "base64 dari: SIEM Off-Chain API\\nwallet: <alamat>\\ntimestamp: <unix>\\nnonce: <acak>",
      });
    }

    const hasil = verifySignature({ message, signature, wallet });
    if (!hasil.ok) {
      return res.status(401).json({ error: "Tanda tangan tidak sah", detail: hasil.reason });
    }
    if (!nonceStore.pakai(hasil.nonce, hasil.ts)) {
      return res.status(409).json({ error: "Nonce sudah dipakai", detail: "Tanda tangani pesan baru." });
    }

    let roleName;
    try {
      roleName = await roleOf(hasil.wallet);
    } catch (err) {
      return res.status(503).json({
        error: "Gagal membaca role on-chain",
        detail: String(err.message || err),
      });
    }

    if (!roleAllows(action, roleName)) {
      return res.status(403).json({
        error: "Role tidak cukup",
        detail: `Role on-chain kamu: ${roleName}. Aksi "${action}" butuh: ${ACTION_ROLES[action].join(" / ")}.`,
      });
    }

    req.wallet = hasil.wallet;
    req.roleName = roleName;
    next();
  };
}

module.exports = {
  MAX_AGE_SEC,
  ACTION_ROLES,
  buildMessage,
  encodeMessage,
  decodeMessage,
  parseMessage,
  isFresh,
  roleAllows,
  normalizeWallet,
  verifySignature,
  createNonceStore,
  requireWallet,
};
