
const { ethers } = require("hardhat");

async function main() {
  const [owner] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const Factory = await ethers.getContractFactory("SIEMLogger");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("");
  console.log("SIEMLogger deployed");
  console.log("  contract address :", address);
  console.log("  chainId          :", net.chainId.toString());
  console.log("  deployer (ADMIN) :", owner.address);
  console.log("  version          :", await contract.VERSION());
  console.log("");
  console.log("Salin ke deployments.json / .env:");
  console.log("  CONTRACT_ADDRESS=" + address);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
