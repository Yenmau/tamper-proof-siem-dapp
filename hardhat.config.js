require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/**
 * Konfigurasi Hardhat — dipakai HANYA untuk `npm test` (uji otomatis kontrak).
 * Vincent tetap bisa kerja seperti biasa di Remix IDE; file ini tidak perlu
 * dipakai kalau tidak mau menjalankan test lokal.
 *
 * Angka di bawah HARUS sama dengan setting di Remix supaya ABI + bytecode
 * yang dipakai tim identik:
 *   Solidity   : 0.8.26   (Remix: tab Solidity Compiler -> pilih 0.8.26)
 *   Optimizer  : enabled, runs 200
 *   EVM target : paris
 */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    // Dipakai `npx hardhat run scripts/deploy.js --network localhost`.
    // RPC_URL boleh diarahkan ke node lain (mis. service `chain` di docker compose);
    // default tetap node lokal 127.0.0.1:8545 seperti sebelumnya.
    localhost: { url: process.env.RPC_URL || "http://127.0.0.1:8545" },
  },
};
