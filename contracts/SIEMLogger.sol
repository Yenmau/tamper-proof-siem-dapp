// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SIEM{
    struct LogEntry {
        string logHash;  
        uint256 timestamp;  
        bool isTampered;     
    }

    address public admin;

    mapping(string => LogEntry) public logs;

    event LogRecorded(string indexed logId, string logHash, uint256 timestamp);
    event TamperingDetected(string indexed logId, string expectedHash, string actualHash);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Hanya admin yang punya akses!");
        _;
    }

    constructor() {
        admin = msg.sender; 
    }

    // Fungsi 1: Simpan Hash Log asli pertama kali ke Blockchain (On-Chain)
    function recordLogHash(string memory _logId, string memory _logHash) public onlyAdmin {
        require(bytes(logs[_logId].logHash).length == 0, "Log ID sudah terdaftar!");

        logs[_logId] = LogEntry({
            logHash: _logHash,
            timestamp: block.timestamp,
            isTampered: false
        });

        emit LogRecorded(_logId, _logHash, block.timestamp);
    }

    // Fungsi 2: Verifikasi apakah log server di-tamper/diubah
    function verifyLogIntegrity(string memory _logId, string memory _currentServerHash) public returns (bool) {
        require(bytes(logs[_logId].logHash).length > 0, "Log ID tidak ditemukan!");

        string memory originalHash = logs[_logId].logHash;

        // Bandingkan Hash asli di blockchain dengan Hash dari server saat ini
        if (keccak256(abi.encodePacked(originalHash)) != keccak256(abi.encodePacked(_currentServerHash))) {
            logs[_logId].isTampered = true;
            emit TamperingDetected(_logId, originalHash, _currentServerHash);
            return false; // Terdeteksi diubah!
        }

        return true; // Log aman/cocok
    }

    // Fungsi 3: Cek status log
    function getLogStatus(string memory _logId) public view returns (string memory, uint256, bool) {
        require(bytes(logs[_logId].logHash).length > 0, "Log ID tidak ditemukan!");
        LogEntry memory log = logs[_logId];
        return (log.logHash, log.timestamp, log.isTampered);
    }
}
