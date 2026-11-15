const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const ADDR_ENV = process.env.CONTRACT_ADDRESS || "";
const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "contracts", "SIEMLogger.json"), "utf8"));

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const addr = ADDR_ENV || fs.readFileSync("/state/contract-address.txt", "utf8").trim();
  const admin = await provider.getSigner(0);
  const analyst = await provider.getSigner(1);
  const auditor = await provider.getSigner(2);
  const outsider = await provider.getSigner(5);

  const c = new ethers.Contract(addr, ABI, provider);
  const cAdmin = c.connect(admin);

  console.log("kontrak   :", addr);
  console.log("VERSION() :", await c.VERSION());
  console.log("chainId   :", (await provider.getNetwork()).chainId.toString());

  for (const [signer, fn, target] of [
    [analyst, "addAnalyst", "SOC_ANALYST"],
    [auditor, "addAuditor", "AUDITOR"],
  ]) {
    const now = await c.getRoleName(signer.address);
    if (now === "NONE") {
      const rc0 = await (await cAdmin[fn](signer.address)).wait();
      console.log(`setup  : ${fn}(${signer.address.slice(0, 10)}…) gas=${rc0.gasUsed}`);
    } else {
      console.log(`setup  : ${signer.address.slice(0, 10)}… sudah ${now}, dilewati`);
    }
  }
  for (const [nama, signer] of [["ADMIN", admin], ["SOC_ANALYST", analyst], ["AUDITOR", auditor], ["OUTSIDER", outsider]]) {
    console.log(`getRoleName(${nama.padEnd(11)}) =`, await c.getRoleName(signer.address));
  }

  const id = "ASSET-VERIFY-001";
  const cab = c.connect(analyst);

  let rc = await (await cab.createAsset(id, "Server Dell R740", "hardware", "Rack A1")).wait();
  console.log(`\n[INSERT] createAsset  gas=${rc.gasUsed}  count=${await c.getAssetCount()}`);
  let a = await c.getAsset(id);
  console.log(`[VIEW]   getAsset -> name=${a.name} | cat=${a.category} | loc=${a.location} | createdBy=${a.createdBy}`);
  rc = await (await cab.updateAsset(id, "Server Dell R740 (upgraded)", "hardware", "Rack B2")).wait();
  a = await c.getAsset(id);
  console.log(`[UPDATE] updateAsset gas=${rc.gasUsed} -> name=${a.name} | loc=${a.location} | updatedBy=${a.updatedBy}`);

  try {
    await (await cab.deleteAsset(id)).wait();
    console.log("[RBAC]   [GAGAL] SOC_ANALYST berhasil delete (harusnya gagal)");
  } catch (e) {
    console.log("[RBAC]   [OK] SOC_ANALYST ditolak delete:", (e.shortMessage || e.message).slice(0, 60));
  }
  try {
    await (await c.connect(auditor).deleteAsset(id)).wait();
    console.log("[RBAC]   [GAGAL] AUDITOR berhasil delete (harusnya gagal)");
  } catch (e) {
    console.log("[RBAC]   [OK] AUDITOR ditolak delete");
  }
  for (const [nama, s] of [["AUDITOR", auditor], ["OUTSIDER", outsider]]) {
    try {
      await (await c.connect(s).updateAsset(id, "x", "y", "z")).wait();
      console.log(`[RBAC]   [GAGAL] ${nama} berhasil update (harusnya gagal)`);
    } catch (e) {
      console.log(`[RBAC]   [OK] ${nama} ditolak update`);
    }
  }

  rc = await (await cAdmin.deleteAsset(id)).wait();
  console.log(`[DELETE] deleteAsset  gas=${rc.gasUsed} -> count=${await c.getAssetCount()}`);
  try {
    await c.getAsset(id);
    console.log("[DELETE] [GAGAL] data masih ada");
  } catch (e) {
    console.log("[DELETE] [OK] data benar-benar hilang (getAsset revert:", (e.shortMessage || e.message).slice(0, 40) + ")");
  }
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
