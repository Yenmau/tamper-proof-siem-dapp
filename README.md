# 🛡️ Tamper-Proof SIEM dApp

A Web3-based SIEM application to detect and prevent server log tampering using Ethereum smart contracts.

---

## 📌 Key Features
* **Log Integrity Check:** Hashes server log batches using SHA-256 and stores the proof on-chain.
* **Tamper Detection:** Real-time alert when local log hashes mismatch with the blockchain record.
* **Role-Based Access Control:** Configured for SOC Analyst, Forensic Investigator, and Security Admin.

---

## 🛠️ Tech Stack & Workflow Guide

### 1. Smart Contract (`/contracts/SIEMLogger.sol`)
* **Tool:** [Remix IDE Website](https://remix.ethereum.org) *(Tidak perlu install Node.js/npm)*
* **How to Run:**
  1. Open Remix IDE and copy `contracts/SIEMLogger.sol`.
  2. Compile using Solidity version `0.8.20`.
  3. Deploy to `Remix VM` or testnet (Sepolia/Amoy) using MetaMask.

### 2. Backend Log Collector (`/backend`)
* **Tool:** VS Code & Node.js
* **Purpose:** Reads local `.log` files, generates SHA-256 hash, and compares it with the blockchain record.
* **How to Run:**
  ```bash
  cd backend
  npm install        # Downloads required libraries (ethers, crypto, etc.)
  node logCollector.js
