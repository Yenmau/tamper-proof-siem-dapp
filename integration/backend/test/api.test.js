// integration/backend/test/api.test.js
//
// Unit test untuk API off-chain — bagian yang MURNI (tanpa jaringan & MongoDB):
// format pesan login, verifikasi tanda tangan, umur tanda tangan, nonce sekali
// pakai, dan matriks izin role. Jalankan: npm run test:api

const assert = require("assert");
const { ethers } = require("ethers");
const auth = require("../api/lib/auth");

let lulus = 0;
let gagal = 0;
const hasil = [];

function uji(nama, fn) {
  try {
    fn();
    lulus++;
    hasil.push(`  ✔ ${nama}`);
  } catch (err) {
    gagal++;
    hasil.push(`  ✘ ${nama}\n      ${err.message}`);
  }
}

async function ujiAsync(nama, fn) {
  try {
    await fn();
    lulus++;
    hasil.push(`  ✔ ${nama}`);
  } catch (err) {
    gagal++;
    hasil.push(`  ✘ ${nama}\n      ${err.message}`);
  }
}

async function main() {
  console.log("\nAPI off-chain — autentikasi wallet & izin role\n");

  const wallet = ethers.Wallet.createRandom();
  const alamat = wallet.address;
  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = "abc123";
  const pesan = auth.buildMessage({ wallet: alamat, ts: nowSec, nonce });
  const tandaTangan = await wallet.signMessage(pesan);

  // --- format pesan -------------------------------------------------------
  uji("buildMessage menghasilkan format yang bisa dibaca ulang", () => {
    const p = auth.parseMessage(pesan);
    assert.ok(p, "parseMessage harus berhasil");
    assert.strictEqual(p.wallet, alamat.toLowerCase());
    assert.strictEqual(p.ts, nowSec);
    assert.strictEqual(p.nonce, nonce);
  });

  uji("parseMessage menolak pesan asing / tidak lengkap", () => {
    assert.strictEqual(auth.parseMessage("halo"), null);
    assert.strictEqual(auth.parseMessage(null), null);
    assert.strictEqual(auth.parseMessage("SIEM Off-Chain API\nwallet: 0x123"), null);
    assert.strictEqual(
      auth.parseMessage("SIEM Off-Chain API\nwallet: bukan-alamat\ntimestamp: 1\nnonce: x"),
      null
    );
    assert.strictEqual(
      auth.parseMessage("SIEM Off-Chain API\nwallet: 0x" + "a".repeat(40) + "\ntimestamp: bukan-angka\nnonce: x"),
      null
    );
  });

  uji("encode/decode pesan: baris baru tidak boleh masuk HTTP header", () => {
    const b64 = auth.encodeMessage(pesan);
    assert.ok(!b64.includes("\n"), "base64 tidak boleh mengandung baris baru");
    assert.strictEqual(auth.decodeMessage(b64), pesan);
    assert.strictEqual(auth.decodeMessage("bukan-base64-pesan"), null);
    assert.strictEqual(auth.decodeMessage(""), null);
    assert.strictEqual(auth.decodeMessage(undefined), null);
  });

  // --- umur tanda tangan --------------------------------------------------
  uji("isFresh: sekarang lolos, 10 menit lalu ditolak, masa depan jauh ditolak", () => {
    assert.strictEqual(auth.isFresh(nowSec, nowSec), true);
    assert.strictEqual(auth.isFresh(nowSec - 299, nowSec), true);
    assert.strictEqual(auth.isFresh(nowSec - 301, nowSec), false);
    assert.strictEqual(auth.isFresh(nowSec + 600, nowSec), false);
    assert.strictEqual(auth.isFresh(nowSec + 10, nowSec), true); // toleransi jam bergeser
    assert.strictEqual(auth.isFresh(NaN, nowSec), false);
  });

  // --- verifikasi tanda tangan -------------------------------------------
  uji("tanda tangan sah diterima", () => {
    const r = auth.verifySignature({ message: pesan, signature: tandaTangan, wallet: alamat, nowSec });
    assert.strictEqual(r.ok, true, r.reason);
    assert.strictEqual(r.wallet, alamat.toLowerCase());
  });

  uji("alamat di header beda dengan isi pesan -> ditolak", () => {
    const lain = ethers.Wallet.createRandom().address;
    const r = auth.verifySignature({ message: pesan, signature: tandaTangan, wallet: lain, nowSec });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "alamat_beda_dengan_pesan");
  });

  uji("pesan diubah setelah ditandatangani -> ditolak", () => {
    const diubah = auth.buildMessage({ wallet: alamat, ts: nowSec, nonce: "nonce-lain" });
    const r = auth.verifySignature({ message: diubah, signature: tandaTangan, wallet: alamat, nowSec });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "pemilik_tidak_cocok");
  });

  uji("tanda tangan milik wallet lain -> ditolak", () => {
    const r = auth.verifySignature({ message: pesan, signature: "0x" + "11".repeat(65), wallet: alamat, nowSec });
    assert.strictEqual(r.ok, false);
    assert.ok(["tanda_tangan_rusak", "pemilik_tidak_cocok"].includes(r.reason), r.reason);
  });

  uji("tanda tangan kedaluwarsa ditolak walau sah", () => {
    const lama = nowSec - 4000;
    const p = auth.buildMessage({ wallet: alamat, ts: lama, nonce });
    const r = auth.verifySignature({ message: p, signature: tandaTangan, wallet: alamat, nowSec });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "tanda_tangan_basi");
  });

  uji("header kosong ditolak", () => {
    assert.strictEqual(auth.verifySignature({ message: pesan, signature: "", wallet: alamat, nowSec }).reason, "tanda_tangan_kosong");
    assert.strictEqual(auth.verifySignature({ message: pesan, signature: tandaTangan, wallet: "bukan", nowSec }).reason, "alamat_tidak_valid");
  });

  // --- matriks izin -------------------------------------------------------
  uji("roleAllows: ADMIN penuh, SOC_ANALYST tanpa delete, AUDITOR read-only", () => {
    assert.strictEqual(auth.roleAllows("read", "ADMIN"), true);
    assert.strictEqual(auth.roleAllows("write", "ADMIN"), true);
    assert.strictEqual(auth.roleAllows("delete", "ADMIN"), true);

    assert.strictEqual(auth.roleAllows("read", "SOC_ANALYST"), true);
    assert.strictEqual(auth.roleAllows("write", "SOC_ANALYST"), true);
    assert.strictEqual(auth.roleAllows("delete", "SOC_ANALYST"), false);

    assert.strictEqual(auth.roleAllows("read", "AUDITOR"), true);
    assert.strictEqual(auth.roleAllows("write", "AUDITOR"), false);
    assert.strictEqual(auth.roleAllows("delete", "AUDITOR"), false);

    assert.strictEqual(auth.roleAllows("read", "NONE"), false);
    assert.strictEqual(auth.roleAllows("write", ""), false);
    assert.strictEqual(auth.roleAllows("aksi-ngawur", "ADMIN"), false);
  });

  uji("normalizeWallet: alamat sah dinormalkan, yang ngawur ditolak", () => {
    assert.strictEqual(auth.normalizeWallet(alamat), alamat.toLowerCase());
    assert.strictEqual(auth.normalizeWallet(alamat.toUpperCase().replace("0X", "0x")), alamat.toLowerCase());
    assert.strictEqual(auth.normalizeWallet("0x123"), null);
    assert.strictEqual(auth.normalizeWallet(""), null);
  });

  // --- nonce sekali pakai -------------------------------------------------
  uji("nonce tidak bisa dipakai dua kali", () => {
    const store = auth.createNonceStore();
    assert.strictEqual(store.pakai("n1", nowSec), true);
    assert.strictEqual(store.pakai("n1", nowSec), false, "nonce kedua harus ditolak");
    assert.strictEqual(store.pakai("n2", nowSec), true);
  });

  uji("nonce lama dibersihkan otomatis (tidak menumpuk)", () => {
    const store = auth.createNonceStore({ maxAgeSec: 10 });
    store.pakai("lama", nowSec - 100);
    assert.strictEqual(store.size(), 1);
    store.pakai("baru", nowSec); // memicu pembersihan
    assert.strictEqual(store.size(), 1, "nonce lama harus ikut terhapus");
    assert.strictEqual(store.pakai("lama", nowSec), true, "nonce lama boleh dipakai lagi setelah kedaluwarsa");
  });

  // --- middleware end-to-end (tanpa HTTP server) --------------------------
  await ujiAsync("middleware: tanpa header -> 401", async () => {
    const mw = auth.requireWallet("write", { roleOf: async () => "ADMIN", nonceStore: auth.createNonceStore() });
    const res = tangkapRes();
    await mw({ get: () => undefined }, res, () => {
      throw new Error("next() tidak boleh dipanggil");
    });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error, "Butuh login wallet");
  });

  await ujiAsync("middleware: role NONE -> 403, pesan menyebut role yang dibutuhkan", async () => {
    const mw = auth.requireWallet("write", { roleOf: async () => "NONE", nonceStore: auth.createNonceStore() });
    const res = tangkapRes();
    await mw(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), res, () => {
      throw new Error("next() tidak boleh dipanggil");
    });
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.detail, /NONE/);
    assert.match(res.body.detail, /ADMIN/);
  });

  await ujiAsync("middleware: AUDITOR boleh read, ditolak delete", async () => {
    const store = auth.createNonceStore();
    const mwRead = auth.requireWallet("read", { roleOf: async () => "AUDITOR", nonceStore: store });
    const resRead = tangkapRes();
    let lanjut = false;
    await mwRead(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), resRead, () => {
      lanjut = true;
    });
    assert.strictEqual(lanjut, true, "AUDITOR harus boleh membaca");

    const mwDel = auth.requireWallet("delete", { roleOf: async () => "AUDITOR", nonceStore: auth.createNonceStore() });
    const resDel = tangkapRes();
    await mwDel(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), resDel, () => {
      throw new Error("next() tidak boleh dipanggil");
    });
    assert.strictEqual(resDel.statusCode, 403);
  });

  await ujiAsync("middleware: tanda tangan yang sudah dipakai tidak bisa diulang (replay)", async () => {
    const store = auth.createNonceStore();
    const mw = auth.requireWallet("read", { roleOf: async () => "ADMIN", nonceStore: store });
    const res1 = tangkapRes();
    await mw(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), res1, () => {});
    assert.strictEqual(res1.statusCode, undefined, "percobaan pertama harus lolos");

    const res2 = tangkapRes();
    await mw(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), res2, () => {
      throw new Error("next() tidak boleh dipanggil");
    });
    assert.strictEqual(res2.statusCode, 409);
  });

  await ujiAsync("middleware: RPC mati -> 503, bukan 500 misterius", async () => {
    const mw = auth.requireWallet("read", {
      roleOf: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:8545");
      },
      nonceStore: auth.createNonceStore(),
    });
    const res = tangkapRes();
    await mw(reqPalsu({ wallet: alamat, message: pesan, signature: tandaTangan }), res, () => {
      throw new Error("next() tidak boleh dipanggil");
    });
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.body.detail, /ECONNREFUSED/);
  });

  console.log(hasil.join("\n"));
  console.log(`\n${lulus} lulus, ${gagal} gagal\n`);
  if (gagal) process.exit(1);
}

// --- helper tiruan objek Express -------------------------------------------
function tangkapRes() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function reqPalsu({ wallet, message, signature }) {
  const headers = {
    "x-wallet": wallet,
    // Header HTTP tidak boleh berisi baris baru -> dikirim base64, seperti
    // yang dilakukan klien sungguhan (dashboard & smoke test).
    "x-message": auth.encodeMessage(message),
    "x-signature": signature,
  };
  return { get: (nama) => headers[String(nama).toLowerCase()] };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
