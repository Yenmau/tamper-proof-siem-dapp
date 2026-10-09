const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyUint } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// Hash contoh, meniru keluaran SHA-256 dari backend (64 hex char).
const H1 = "0x" + "a".repeat(64);
const H2 = "0x" + "b".repeat(64);
const H_TAMPERED = "0x" + "f".repeat(64);

// Role enum: 0=NONE, 1=AUDITOR, 2=SOC_ANALYST, 3=ADMIN
const NONE = 0n;
const AUDITOR = 1n;
const ANALYST = 2n;
const ADMIN = 3n;

async function deploy() {
  const [owner, analyst, auditor, outsider] = await ethers.getSigners();
  const F = await ethers.getContractFactory("SIEMLogger");
  const c = await F.deploy();
  await c.waitForDeployment();
  return { c, owner, analyst, auditor, outsider };
}

describe("SIEMLogger v3.0", function () {
  // -------------------------------------------------------------------
  describe("A. Dasar & RBAC", function () {
    it("1. deploy: owner jadi ADMIN pertama, VERSION 3.0.0", async function () {
      const { c, owner } = await deploy();
      expect(await c.VERSION()).to.equal("3.0.0");
      expect(await c.admin()).to.equal(owner.address);
      expect(await c.roles(owner.address)).to.equal(ADMIN);
      expect(await c.isAdmin(owner.address)).to.equal(true);
      expect(await c.isOperator(owner.address)).to.equal(true);
      expect(await c.hasRole(owner.address)).to.equal(true);
      expect(await c.adminCount()).to.equal(1n);
      expect(await c.getAdmins()).to.deep.equal([owner.address]);
      expect(await c.getRoleName(owner.address)).to.equal("ADMIN");
    });

    it("2. setRole: ADMIN -> SOC_ANALYST / AUDITOR, nama role benar", async function () {
      const { c, analyst, auditor } = await deploy();

      await expect(c.addAnalyst(analyst.address))
        .to.emit(c, "RoleAssigned")
        .withArgs(analyst.address, ANALYST);
      expect(await c.roles(analyst.address)).to.equal(ANALYST);
      expect(await c.getRoleName(analyst.address)).to.equal("SOC_ANALYST");
      expect(await c.hasRole(analyst.address)).to.equal(true);
      expect(await c.isAdmin(analyst.address)).to.equal(false);
      expect(await c.isOperator(analyst.address)).to.equal(true);

      await expect(c.addAuditor(auditor.address))
        .to.emit(c, "RoleAssigned")
        .withArgs(auditor.address, AUDITOR);
      expect(await c.getRoleName(auditor.address)).to.equal("AUDITOR");
      // auditor punya role, TAPI bukan operator (tidak boleh tulis state)
      expect(await c.hasRole(auditor.address)).to.equal(true);
      expect(await c.isOperator(auditor.address)).to.equal(false);
      expect(await c.isAdmin(auditor.address)).to.equal(false);
    });

    it("3. SOC_ANALYST boleh menulis log, tapi TIDAK boleh kelola role", async function () {
      const { c, analyst, outsider } = await deploy();
      await c.addAnalyst(analyst.address);

      // boleh menulis
      await c.connect(analyst).recordLogHash("auth.log", H1);
      expect((await c.getLogStatus("auth.log"))[0]).to.equal(H1);
      // recordedBy mencatat akun analyst
      expect((await c.getLogEntry("auth.log"))[4]).to.equal(analyst.address);

      // boleh memverifikasi (dan memicu alarm)
      await expect(c.connect(analyst).verifyLogIntegrity("auth.log", H_TAMPERED))
        .to.emit(c, "TamperingDetected")
        .withArgs("auth.log", H1, H_TAMPERED);

      // TIDAK boleh kelola role
      await expect(
        c.connect(analyst).setRole(outsider.address, ANALYST)
      ).to.be.revertedWithCustomError(c, "NotAdmin");
      await expect(
        c.connect(analyst).addAdmin(outsider.address)
      ).to.be.revertedWithCustomError(c, "NotAdmin");
    });

    it("4. AUDITOR read-only: boleh lihat & verifyLogIntegrityView, TIDAK boleh tulis", async function () {
      const { c, auditor } = await deploy();
      await c.addAuditor(auditor.address);
      await c.recordLogHash("auth.log", H1); // didaftarkan oleh owner

      // boleh membaca
      const s = await c.connect(auditor).getLogStatus("auth.log");
      expect(s[0]).to.equal(H1);

      // boleh verifikasi GRATIS (view) — inti tugas auditor
      expect(
        await c.connect(auditor).verifyLogIntegrityView("auth.log", H1)
      ).to.equal(true);
      expect(
        await c.connect(auditor).verifyLogIntegrityView("auth.log", H_TAMPERED)
      ).to.equal(false);

      // TIDAK boleh menulis state
      await expect(
        c.connect(auditor).recordLogHash("other.log", H1)
      ).to.be.revertedWithCustomError(c, "NotOperator");
      await expect(
        c.connect(auditor).verifyLogIntegrity("auth.log", H_TAMPERED)
      ).to.be.revertedWithCustomError(c, "NotOperator");

      // dan tidak boleh menyentuh role
      await expect(
        c.connect(auditor).setRole(auditor.address, ANALYST)
      ).to.be.revertedWithCustomError(c, "NotAdmin");
    });

    it("5. akun tanpa role (NONE): tidak bisa tulis, tapi tetap bisa baca", async function () {
      const { c, outsider } = await deploy();
      await c.recordLogHash("auth.log", H1);

      await expect(
        c.connect(outsider).recordLogHash("x.log", H1)
      ).to.be.revertedWithCustomError(c, "NotOperator");
      await expect(
        c.connect(outsider).verifyLogIntegrity("auth.log", H1)
      ).to.be.revertedWithCustomError(c, "NotOperator");

      // baca tetap boleh (data on-chain publik)
      expect((await c.connect(outsider).getLogStatus("auth.log"))[0]).to.equal(H1);
      expect(
        await c.connect(outsider).verifyLogIntegrityView("auth.log", H1)
      ).to.equal(true);
    });

    it("6. ADMIN bisa menambah ADMIN lain & mencabutnya", async function () {
      const { c, analyst, outsider } = await deploy();

      await expect(c.addAdmin(analyst.address))
        .to.emit(c, "AdminAdded")
        .withArgs(analyst.address);
      expect(await c.adminCount()).to.equal(2n);
      expect(await c.isAdmin(analyst.address)).to.equal(true);
      expect(await c.getAdmins()).to.deep.equal([await (await c.admin()), analyst.address]);
      expect(await c.getRoleName(analyst.address)).to.equal("ADMIN");

      // admin (bukan owner) juga boleh mengangkat role orang lain
      await c.connect(analyst).addAuditor(outsider.address);
      expect(await c.roles(outsider.address)).to.equal(AUDITOR);

      // cabut admin
      await expect(c.removeAdmin(analyst.address))
        .to.emit(c, "AdminRemoved")
        .withArgs(analyst.address);
      expect(await c.adminCount()).to.equal(1n);
      expect(await c.isAdmin(analyst.address)).to.equal(false);
    });

    it("7. proteksi & validasi role", async function () {
      const { c, owner, analyst, outsider } = await deploy();
      await c.addAnalyst(analyst.address);

      // hanya ADMIN yang boleh mengubah role
      await expect(
        c.connect(outsider).setRole(outsider.address, ANALYST)
      ).to.be.revertedWithCustomError(c, "NotAdmin");

      // owner tidak bisa diubah/dicabut
      await expect(
        c.setRole(owner.address, ANALYST)
      ).to.be.revertedWithCustomError(c, "CannotChangeOwner");
      await expect(
        c.removeRole(owner.address)
      ).to.be.revertedWithCustomError(c, "CannotChangeOwner");

      // address(0) ditolak
      await expect(
        c.setRole(ethers.ZeroAddress, ANALYST)
      ).to.be.revertedWithCustomError(c, "InvalidAddress");

      // tidak boleh set role NONE lewat setRole (pakai removeRole)
      await expect(
        c.setRole(outsider.address, NONE)
      ).to.be.revertedWithCustomError(c, "InvalidRole");

      // set ke role yang sama -> SameRole
      await expect(
        c.setRole(analyst.address, ANALYST)
      ).to.be.revertedWithCustomError(c, "SameRole").withArgs(analyst.address, ANALYST);

      // removeRole pada akun tanpa role -> SameRole(account, NONE)
      await expect(
        c.removeRole(outsider.address)
      ).to.be.revertedWithCustomError(c, "SameRole").withArgs(outsider.address, NONE);

      // removeRole yang sah -> RoleRevoked + kembali NONE
      await expect(c.removeRole(analyst.address))
        .to.emit(c, "RoleRevoked")
        .withArgs(analyst.address, ANALYST);
      expect(await c.roles(analyst.address)).to.equal(NONE);
      expect(await c.hasRole(analyst.address)).to.equal(false);
      await expect(
        c.connect(analyst).recordLogHash("x.log", H1)
      ).to.be.revertedWithCustomError(c, "NotOperator");
    });
  });

  // -------------------------------------------------------------------
  describe("B. Fungsi inti (kompatibel v1.0)", function () {
    it("8. recordLogHash menyimpan hash + getLogStatus mengembalikannya", async function () {
      const { c, owner } = await deploy();
      await expect(c.recordLogHash("auth.log", H1))
        .to.emit(c, "LogRecorded")
        .withArgs("auth.log", H1, anyUint);

      const s = await c.getLogStatus("auth.log");
      expect(s[0]).to.equal(H1);
      expect(s[1]).to.be.greaterThan(0n);
      expect(s[2]).to.equal(false);
      expect(await c.getLogCount()).to.equal(1n);
      expect(await c.getLogIds()).to.deep.equal(["auth.log"]);

      const e = await c.getLogEntry("auth.log");
      expect(e[3]).to.equal(false);
      expect(e[4]).to.equal(owner.address);
    });

    it("9. logId tidak bisa didaftarkan dua kali", async function () {
      const { c } = await deploy();
      await c.recordLogHash("auth.log", H1);
      await expect(c.recordLogHash("auth.log", H2))
        .to.be.revertedWithCustomError(c, "LogAlreadyExists")
        .withArgs("auth.log");
    });

    it("10. verifyLogIntegrity: hash cocok -> true, TIDAK ada alarm", async function () {
      const { c } = await deploy();
      await c.recordLogHash("auth.log", H1);

      expect(await c.verifyLogIntegrity.staticCall("auth.log", H1)).to.equal(true);

      const tx = await c.verifyLogIntegrity("auth.log", H1);
      const rc = await tx.wait();
      await expect(tx).to.not.emit(c, "TamperingDetected");
      await expect(tx).to.emit(c, "LogVerified");

      const s = await c.getLogStatus("auth.log");
      expect(s[2]).to.equal(false);
      expect((await c.getLogEntry("auth.log"))[2]).to.be.greaterThan(0n);
      console.log("        gas verifyLogIntegrity (cocok) =", rc.gasUsed.toString());
    });

    it("11. verifyLogIntegrity: HASH DIUBAH -> false + event TamperingDetected", async function () {
      const { c } = await deploy();
      await c.recordLogHash("auth.log", H1);

      expect(await c.verifyLogIntegrity.staticCall("auth.log", H_TAMPERED)).to.equal(false);

      await expect(c.verifyLogIntegrity("auth.log", H_TAMPERED))
        .to.emit(c, "TamperingDetected")
        .withArgs("auth.log", H1, H_TAMPERED);

      expect((await c.getLogStatus("auth.log"))[2]).to.equal(true);
    });

    it("12. verifyLogIntegrityView: gratis, hasil sama, tidak mengubah state", async function () {
      const { c } = await deploy();
      await c.recordLogHash("auth.log", H1);

      expect(await c.verifyLogIntegrityView("auth.log", H1)).to.equal(true);
      expect(await c.verifyLogIntegrityView("auth.log", H_TAMPERED)).to.equal(false);
      expect((await c.getLogStatus("auth.log"))[2]).to.equal(false);
    });

    it("13. logId yang belum terdaftar -> LogNotFound", async function () {
      const { c } = await deploy();
      await expect(c.getLogStatus("ghost.log"))
        .to.be.revertedWithCustomError(c, "LogNotFound");
      await expect(c.verifyLogIntegrity("ghost.log", H1))
        .to.be.revertedWithCustomError(c, "LogNotFound");
      await expect(c.verifyLogIntegrityView("ghost.log", H1))
        .to.be.revertedWithCustomError(c, "LogNotFound");
    });

    it("14. recordLogHashBatch: impor banyak log", async function () {
      const { c } = await deploy();
      const ids = ["a.log", "b.log", "c.log", "d.log", "e.log"];
      const hashes = [H1, H2, H1, H2, H1];

      await expect(c.recordLogHashBatch(ids, hashes)).to.emit(c, "LogRecorded");
      expect(await c.getLogCount()).to.equal(5n);
      expect(await c.getLogIds()).to.deep.equal(ids);
      expect((await c.getLogStatus("c.log"))[0]).to.equal(H1);
      expect(await c.getLogIdAt(4)).to.equal("e.log");

      await expect(c.recordLogHashBatch(["x.log"], []))
        .to.be.revertedWithCustomError(c, "LengthMismatch");
      await expect(c.recordLogHashBatch(["dup.log", "a.log"], [H1, H1]))
        .to.be.revertedWithCustomError(c, "LogAlreadyExists").withArgs("a.log");
    });

    it("15. gas: batch lebih murah per log daripada single", async function () {
      const { c } = await deploy();
      const g1 = (await (await c.recordLogHash("single.log", H1)).wait()).gasUsed;

      const ids = ["b1.log", "b2.log", "b3.log", "b4.log", "b5.log"];
      const hs = [H1, H1, H1, H1, H1];
      const g5 = (await (await c.recordLogHashBatch(ids, hs)).wait()).gasUsed;

      console.log("        1 log  (single tx)  =", g1.toString(), "gas");
      console.log("        5 log  (1 batch tx) =", g5.toString(), "gas");
      console.log("        rata-rata batch     =", (g5 / 5n).toString(), "gas/log");

      expect(g5 / 5n).to.be.lessThan(g1);
    });
  });
});
