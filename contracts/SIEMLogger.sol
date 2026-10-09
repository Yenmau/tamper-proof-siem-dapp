// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  SIEMLogger
 * @author Vincent Tiono — Smart Contract / Web3 Lead
 * @notice Registry "sidik jari" (hash) file log server di blockchain.
 *         Hash asli dikunci on-chain. Kalau log di server diubah/dihapus oleh
 *         penyerang, hash server tidak akan cocok lagi dengan hash on-chain ->
 *         event `TamperingDetected` dipancarkan -> frontend menaikkan alarm.
 *
 * @dev    VERSI 2.0 — SUPERSET dari v1.0 (backward compatible).
 *         Nama + signature 3 fungsi inti TIDAK berubah, jadi kode backend
 *         (Yasin) maupun frontend (Joseph) yang sudah memakai v1.0 tetap jalan:
 *           - recordLogHash(string,string)
 *           - verifyLogIntegrity(string,string)
 *           - getLogStatus(string)
 *
 *         PERUBAHAN v1.0 -> v2.0 (detail lengkap ada di CHANGELOG.md):
 *           [FIX]  verifyLogIntegrity sekarang `onlyAdmin` (dulu bebas dipanggil
 *                  siapa saja -> orang luar bisa memicu alarm palsu).
 *                  Untuk pengecekan gratis & publik pakai verifyLogIntegrityView.
 *           [NEW]  Multi-admin (isAdmin/addAdmin/removeAdmin/getAdmins).
 *           [NEW]  verifyLogIntegrityView() -> cek integritas GRATIS (view).
 *           [NEW]  recordLogHashBatch() -> hemat gas saat impor banyak log.
 *           [NEW]  getLogEntry / getLogCount / getLogIds / getLogIdAt.
 *           [GAS]  custom error (bukan string require), parameter `calldata`,
 *                  field baru di-pack ke 1 slot storage.
 *           [NOTE] Nama kontrak: SIEM -> SIEMLogger (mengikuti nama file).
 *                  `logs(id)` getter publik sekarang mengembalikan 5 nilai.
 */
contract SIEMLogger {
    /// @notice Versi kontrak, berguna buat ditampilkan di UI.
    string public constant VERSION = "2.0.0";

    // ---------------------------------------------------------------------
    // Struktur data
    // ---------------------------------------------------------------------

    /// @dev `logHash` (string) + `timestamp` (uint256) masing-masing 1 slot.
    ///      `verifiedAt` + `isTampered` + `recordedBy` dipack jadi 1 slot
    ///      (8 + 1 + 20 = 29 byte) -> hemat ~40k gas per log vs 3 slot.
    struct LogEntry {
        string  logHash;     // hash SHA-256 asli (hex string) saat didaftarkan
        uint256 timestamp;   // kapan didaftarkan (block.timestamp)
        uint64  verifiedAt;  // kapan terakhir diverifikasi (0 = belum pernah)
        bool    isTampered;  // true kalau PERNAH terdeteksi tidak cocok
        address recordedBy;  // admin yang mendaftarkan entri ini
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Owner / super-admin (akun yang mendeploy). Satu-satunya yang
    ///         boleh menambah/menghapus admin.
    address public admin;

    /// @notice Multi-admin: akun yang boleh menulis & memverifikasi log.
    mapping(address => bool) public isAdmin;

    /// @notice Jumlah admin aktif (read-only helper).
    uint256 public adminCount;

    /// @notice Registry log: logId => LogEntry.
    mapping(string => LogEntry) public logs;

    address[] private _adminList;
    string[]  private _logIds;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Dipancarkan tiap kali hash log baru dikunci on-chain.
    ///         (signature dipertahankan sama seperti v1.0)
    event LogRecorded(string indexed logId, string logHash, uint256 timestamp);

    /// @notice Dipancarkan tiap kali verifikasi dijalankan (match atau tidak).
    event LogVerified(string indexed logId, string currentHash, bool isMatch, uint256 timestamp);

    /// @notice ⚠️ ALARM. Dipancarkan saat hash server != hash on-chain.
    ///         (signature dipertahankan sama seperti v1.0 -> listener lama tetap jalan)
    event TamperingDetected(string indexed logId, string expectedHash, string actualHash);

    event AdminAdded(address indexed account);
    event AdminRemoved(address indexed account);

    // ---------------------------------------------------------------------
    // Custom errors — lebih murah dari `require` dengan string
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotAdmin();
    error InvalidAddress();
    error AlreadyAdmin(address account);
    error CannotRemoveOwner();
    error LogAlreadyExists(string logId);
    error LogNotFound(string logId);
    error EmptyHash();
    error LengthMismatch();

    // ---------------------------------------------------------------------
    // Modifier
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != admin) revert NotOwner();
        _;
    }

    modifier onlyAdmin() {
        if (!isAdmin[msg.sender]) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() {
        admin = msg.sender;
        isAdmin[msg.sender] = true;
        _adminList.push(msg.sender);
        adminCount = 1;
        emit AdminAdded(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Manajemen admin (v2.0)
    // ---------------------------------------------------------------------

    /// @notice Tambah admin baru (mis. akun khusus server backend Yasin).
    function addAdmin(address _account) external onlyOwner {
        if (_account == address(0)) revert InvalidAddress();
        if (isAdmin[_account]) revert AlreadyAdmin(_account);
        isAdmin[_account] = true;
        _adminList.push(_account);
        adminCount += 1;
        emit AdminAdded(_account);
    }

    /// @notice Cabut hak admin. Owner sendiri tidak bisa dicabut.
    function removeAdmin(address _account) external onlyOwner {
        if (!isAdmin[_account]) revert NotAdmin();
        if (_account == admin) revert CannotRemoveOwner();
        isAdmin[_account] = false;
        adminCount -= 1;

        uint256 len = _adminList.length;
        for (uint256 i = 0; i < len; i++) {
            if (_adminList[i] == _account) {
                _adminList[i] = _adminList[len - 1];
                _adminList.pop();
                break;
            }
        }
        emit AdminRemoved(_account);
    }

    /// @notice Daftar semua admin aktif.
    function getAdmins() external view returns (address[] memory) {
        return _adminList;
    }

    // ---------------------------------------------------------------------
    // FUNGSI 1 — recordLogHash : kunci hash log ke blockchain
    // ---------------------------------------------------------------------

    /// @notice Simpan hash log asli pertama kali ke blockchain.
    /// @dev    Sekali terdaftar, logId tidak bisa ditimpa (immutable).
    function recordLogHash(string calldata _logId, string calldata _logHash)
        external
        onlyAdmin
    {
        _record(_logId, _logHash);
    }

    /// @notice Impor banyak log sekaligus. Biaya dasar 1 transaksi (±21k gas)
    ///         dibagi ke semua item -> jauh lebih murah daripada satu-satu.
    function recordLogHashBatch(
        string[] calldata _ids,
        string[] calldata _hashes
    ) external onlyAdmin {
        if (_ids.length != _hashes.length) revert LengthMismatch();
        for (uint256 i = 0; i < _ids.length; i++) {
            _record(_ids[i], _hashes[i]);
        }
    }

    function _record(string calldata _logId, string calldata _logHash) private {
        if (bytes(_logHash).length == 0) revert EmptyHash();
        if (bytes(logs[_logId].logHash).length != 0) revert LogAlreadyExists(_logId);

        logs[_logId] = LogEntry({
            logHash: _logHash,
            timestamp: block.timestamp,
            verifiedAt: 0,
            isTampered: false,
            recordedBy: msg.sender
        });
        _logIds.push(_logId);

        emit LogRecorded(_logId, _logHash, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // FUNGSI 2 — verifyLogIntegrity : bandingkan hash server vs on-chain
    // ---------------------------------------------------------------------

    /// @notice Bandingkan hash log server saat ini dengan hash asli on-chain.
    ///         Kalau beda -> tandai isTampered + pancarkan TamperingDetected.
    /// @dev    Ini fungsi yang MENULIS state (kena gas), dipanggil oleh backend
    ///         ketika mau menaikkan alarm on-chain. Untuk polling/pengecekan
    ///         rutin yang gratis, pakai `verifyLogIntegrityView`.
    /// @return true kalau hash masih cocok (log aman), false kalau di-tamper.
    function verifyLogIntegrity(
        string calldata _logId,
        string calldata _currentServerHash
    ) external onlyAdmin returns (bool) {
        LogEntry storage entry = logs[_logId];
        if (bytes(entry.logHash).length == 0) revert LogNotFound(_logId);

        bool isMatch = _hashesEqual(entry.logHash, _currentServerHash);

        if (!isMatch) {
            entry.isTampered = true;
            emit TamperingDetected(_logId, entry.logHash, _currentServerHash);
        }

        entry.verifiedAt = uint64(block.timestamp);
        emit LogVerified(_logId, _currentServerHash, isMatch, block.timestamp);

        return isMatch;
    }

    /// @notice Versi GRATIS (view) dari verifikasi — tidak mengubah state dan
    ///         tidak butuh gas. Cocok dipanggil frontend/backend berulang kali
    ///         untuk menampilkan status "AMAN / TAMPERED" secara real-time.
    /// @return true kalau hash masih cocok.
    function verifyLogIntegrityView(
        string calldata _logId,
        string calldata _currentServerHash
    ) external view returns (bool) {
        string memory originalHash = logs[_logId].logHash;
        if (bytes(originalHash).length == 0) revert LogNotFound(_logId);
        return _hashesEqual(originalHash, _currentServerHash);
    }

    // ---------------------------------------------------------------------
    // FUNGSI 3 — getLogStatus : ambil status log
    // ---------------------------------------------------------------------

    /// @notice Ambil (hash asli, waktu daftar, status tampered) sebuah log.
    ///         Signature & urutan return dipertahankan sama seperti v1.0.
    function getLogStatus(string calldata _logId)
        external
        view
        returns (string memory, uint256, bool)
    {
        LogEntry storage entry = logs[_logId];
        if (bytes(entry.logHash).length == 0) revert LogNotFound(_logId);
        return (entry.logHash, entry.timestamp, entry.isTampered);
    }

    /// @notice Versi lengkap dari getLogStatus (termasuk info v2.0).
    function getLogEntry(string calldata _logId)
        external
        view
        returns (
            string memory logHash,
            uint256 timestamp,
            uint64  verifiedAt,
            bool    isTampered,
            address recordedBy
        )
    {
        LogEntry storage entry = logs[_logId];
        if (bytes(entry.logHash).length == 0) revert LogNotFound(_logId);
        return (
            entry.logHash,
            entry.timestamp,
            entry.verifiedAt,
            entry.isTampered,
            entry.recordedBy
        );
    }

    // ---------------------------------------------------------------------
    // Helper listing (v2.0) — supaya UI bisa menampilkan semua log
    // ---------------------------------------------------------------------

    function getLogCount() external view returns (uint256) {
        return _logIds.length;
    }

    function getLogIds() external view returns (string[] memory) {
        return _logIds;
    }

    function getLogIdAt(uint256 _index) external view returns (string memory) {
        return _logIds[_index];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _hashesEqual(string memory _a, string memory _b) private pure returns (bool) {
        return keccak256(abi.encodePacked(_a)) == keccak256(abi.encodePacked(_b));
    }
}
