# 🛡️ Tamper-Proof SIEM dApp

A Web3-based SIEM application to detect and prevent server log tampering using Ethereum smart contracts.

## 📌 Features
* **Log Integrity Check:** Hashes server log batches using SHA-256 and stores the proof on-chain.
* **Tamper Detection:** Real-time alert when local log hashes mismatch with the blockchain record.
* **Role-Based Access Control:** Configured for SOC Analyst, Forensic Investigator, and Security Admin.

## 🛠️ Tech Stack
* **Smart Contract:** Solidity, Remix / Hardhat
* **Backend:** Node.js / Python (SHA-256 Hasher)
* **Frontend:** React / HTML + Tailwind CSS, Ethers.js, MetaMask
* **Infrastructure:** Linux (VM/Docker), `syslog`

## 🚀 Quick Start
```bash
# Clone repository
git clone [https://github.com/username/tamper-proof-siem-dapp.git](https://github.com/username/tamper-proof-siem-dapp.git)

# Run backend log collector
cd tamper-proof-siem-dapp/backend
npm install
node logCollector.js
