const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyUint } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// Hash contoh, meniru keluaran SHA-256 dari backend (64 hex char).
const H1 = "0x" + "a".repeat(64);
const H2 = "0x" + "b".repeat(64);
const H_TAMPERED = "0x" + "f".repeat(64);

async function deploy() {
  const [owner, backend, outsider] = await ethers.getSigners();
  const F = await ethers.getContractFactory("SIEMLogger");
  const c = await F.deploy();
  await c.waitForDeployment();
  return { c, owner, backend, outsider };
}

describe("SIEMLogger v2.0", function () {
  it("1. deploy: owner jadi admin pertama, VERSION benar", async function () {
    const { c, owner } = await deploy();
    expect(await c.VERSION()).to.equal("2.0.0");
    expect(await c.admin()).to.equal(owner.address);
    expect(await c.isAdmin(owner.address)).to.equal(true);
    expect(await c.adminCount()).to.equal(1n);
    expect(await c.getAdmins()).to.deep.equal([owner.address]);
  });

  it("2. recordLogHash menyimpan hash + getLogStatus mengembalikannya", async function () {
    const { c, owner } = await deploy();
    await expect(c.recordLogHash("auth.log", H1))
      .to.emit(c, "LogRecorded")
      .withArgs("auth.log", H1, anyUint);

    const s = await c.getLogStatus("auth.log");
    expect(s[0]).to.equal(H1); // logHash
    expect(s[1]).to.be.greaterThan(0n); // timestamp
    expect(s[2]).to.equal(false); // isTampered
    expect(await c.getLogCount()).to.equal(1n);
    expect(await c.getLogIds()).to.deep.equal(["auth.log"]);

    const e = await c.getLogEntry("auth.log");
    expect(e[3]).to.equal(false); // isTampered
    expect(e[4]).to.equal(owner.address); // recordedBy
  });

  it("3. logId tidak bisa didaftarkan dua kali", async function () {
    const { c } = await deploy();
    await c.recordLogHash("auth.log", H1);
    await expect(c.recordLogHash("auth.log", H2))
      .to.be.revertedWithCustomError(c, "LogAlreadyExists")
      .withArgs("auth.log");
  });

  it("4. hanya admin yang boleh menulis log", async function () {
    const { c, outsider } = await deploy();
    await expect(
      c.connect(outsider).recordLogHash("auth.log", H1)
    ).to.be.revertedWithCustomError(c, "NotAdmin");
  });

  it("5. verifyLogIntegrity: hash cocok -> true, TIDAK ada alarm", async function () {
    const { c } = await deploy();
    await c.recordLogHash("auth.log", H1);

    // dibaca lewat staticCall supaya bisa lihat nilai return
    expect(await c.verifyLogIntegrity.staticCall("auth.log", H1)).to.equal(true);

    const tx = await c.verifyLogIntegrity("auth.log", H1);
    const rc = await tx.wait();
    await expect(tx).to.not.emit(c, "TamperingDetected");
    await expect(tx).to.emit(c, "LogVerified");

    const s = await c.getLogStatus("auth.log");
    expect(s[2]).to.equal(false); // isTampered tetap false
    expect((await c.getLogEntry("auth.log"))[2]).to.be.greaterThan(0n); // verifiedAt terisi
    console.log("        gas verifyLogIntegrity (cocok) =", rc.gasUsed.toString());
  });

  it("6. verifyLogIntegrity: HASH DIUBAH -> false + event TamperingDetected", async function () {
    const { c } = await deploy();
    await c.recordLogHash("auth.log", H1);

    expect(
      await c.verifyLogIntegrity.staticCall("auth.log", H_TAMPERED)
    ).to.equal(false);

    const tx = await c.verifyLogIntegrity("auth.log", H_TAMPERED);
    await expect(tx)
      .to.emit(c, "TamperingDetected")
      .withArgs("auth.log", H1, H_TAMPERED);

    const s = await c.getLogStatus("auth.log");
    expect(s[2]).to.equal(true); // isTampered = true (flag permanen)
  });

  it("7. verifyLogIntegrityView: gratis, hasil sama, tidak mengubah state", async function () {
    const { c } = await deploy();
    await c.recordLogHash("auth.log", H1);

    expect(await c.verifyLogIntegrityView("auth.log", H1)).to.equal(true);
    expect(await c.verifyLogIntegrityView("auth.log", H_TAMPERED)).to.equal(false);

    // view tidak menulis apa pun
    const s = await c.getLogStatus("auth.log");
    expect(s[2]).to.equal(false);
  });

  it("8. logId yang belum terdaftar -> LogNotFound", async function () {
    const { c } = await deploy();
    await expect(
      c.getLogStatus("ghost.log")
    ).to.be.revertedWithCustomError(c, "LogNotFound");
    await expect(
      c.verifyLogIntegrity("ghost.log", H1)
    ).to.be.revertedWithCustomError(c, "LogNotFound");
    await expect(
      c.verifyLogIntegrityView("ghost.log", H1)
    ).to.be.revertedWithCustomError(c, "LogNotFound");
  });

  it("9. multi-admin: addAdmin / removeAdmin / proteksi owner", async function () {
    const { c, owner, backend, outsider } = await deploy();

    // hanya owner yang bisa menambah admin
    await expect(
      c.connect(backend).addAdmin(backend.address)
    ).to.be.revertedWithCustomError(c, "NotOwner");

    await expect(c.addAdmin(backend.address))
      .to.emit(c, "AdminAdded")
      .withArgs(backend.address);
    expect(await c.adminCount()).to.equal(2n);
    expect(await c.isAdmin(backend.address)).to.equal(true);

    // sekarang akun backend bisa menulis log
    await c.connect(backend).recordLogHash("backend.log", H2);
    expect((await c.getLogStatus("backend.log"))[0]).to.equal(H2);

    // tambah dua kali -> AlreadyAdmin
    await expect(c.addAdmin(backend.address))
      .to.be.revertedWithCustomError(c, "AlreadyAdmin")
      .withArgs(backend.address);

    // address(0) ditolak
    await expect(c.addAdmin(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(c, "InvalidAddress");

    // cabut admin
    await expect(c.removeAdmin(backend.address))
      .to.emit(c, "AdminRemoved")
      .withArgs(backend.address);
    expect(await c.adminCount()).to.equal(1n);
    await expect(
      c.connect(backend).recordLogHash("backend.log", H2)
    ).to.be.revertedWithCustomError(c, "NotAdmin");

    // orang yang bukan admin -> NotAdmin
    await expect(c.removeAdmin(outsider.address))
      .to.be.revertedWithCustomError(c, "NotAdmin");

    // owner tidak bisa dicabut
    await expect(c.removeAdmin(owner.address))
      .to.be.revertedWithCustomError(c, "CannotRemoveOwner");
  });

  it("10. recordLogHashBatch: impor banyak log, hemat gas", async function () {
    const { c } = await deploy();
    const ids = ["a.log", "b.log", "c.log", "d.log", "e.log"];
    const hashes = [H1, H2, H1, H2, H1];

    await expect(c.recordLogHashBatch(ids, hashes)).to.emit(c, "LogRecorded");
    expect(await c.getLogCount()).to.equal(5n);
    expect(await c.getLogIds()).to.deep.equal(ids);
    expect((await c.getLogStatus("c.log"))[0]).to.equal(H1);
    expect(await c.getLogIdAt(4)).to.equal("e.log");

    await expect(
      c.recordLogHashBatch(["x.log"], [])
    ).to.be.revertedWithCustomError(c, "LengthMismatch");

    await expect(
      c.recordLogHashBatch(["dup.log", "a.log"], [H1, H1])
    ).to.be.revertedWithCustomError(c, "LogAlreadyExists")
      .withArgs("a.log");
  });

  it("11. gas: bandingkan single vs batch (biaya dasar per transaksi)", async function () {
    const { c } = await deploy();
    const g1 = (await (await c.recordLogHash("single.log", H1)).wait()).gasUsed;

    const ids = ["b1.log", "b2.log", "b3.log", "b4.log", "b5.log"];
    const hs = [H1, H1, H1, H1, H1];
    const g5 = (await (await c.recordLogHashBatch(ids, hs)).wait()).gasUsed;

    console.log("        1 log  (single tx) =", g1.toString(), "gas");
    console.log("        5 log  (1 batch tx) =", g5.toString(), "gas");
    console.log("        rata-rata batch     =", (g5 / 5n).toString(), "gas/log");

    // batch harus lebih murah per log daripada single
    expect(g5 / 5n).to.be.lessThan(g1);
  });
});
