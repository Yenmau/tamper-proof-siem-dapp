// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  SIEMLogger
 * @author Vincent Tiono — Smart Contract Developer / Web3 Lead
 * @notice Registry "sidik jari" (hash) file log server di blockchain.
 *         Hash asli dikunci on-chain. Kalau log di server diubah/dihapus oleh
 *         penyerang, hash server tidak akan cocok lagi dengan hash on-chain ->
 *         event `TamperingDetected` dipancarkan -> frontend menaikkan alarm.
 *
 * @dev    VERSI 3.0
 *
 *         == RBAC 3 ROLE (sesuai pembagian tugas tim) ==
 *         Role          Boleh tulis log   Boleh verifikasi(+alarm)   Boleh kelola role
 *         ---------------------------------------------------------------------------
 *         ADMIN              ya                   ya                     ya
 *         SOC_ANALYST        ya                   ya                     tidak
 *         AUDITOR            tidak                tidak (hanya view)     tidak
 *         (NONE / publik)    tidak                tidak (hanya view)     tidak
 *
 *         Alasan desain: AUDITOR sengaja dibuat READ-ONLY. Prinsip pemisahan
 *         tugas (separation of duties) — auditor tidak boleh punya kemampuan
 *         mengubah data yang dia audit, kalau tidak hasil auditnya tidak
 *         bernilai. Auditor tetap bisa memakai `verifyLogIntegrityView`
 *         (gratis, tidak mengubah state) untuk menguji integritas sendiri.
 *
 *         == KOMPATIBILITAS ==
 *         Tiga fungsi inti dari v1.0 TIDAK berubah nama & signature:
 *           recordLogHash(string,string), verifyLogIntegrity(string,string),
 *           getLogStatus(string)
 *         sehingga kode backend (Yasin) & frontend (Joseph) tetap jalan.
 *         Detail lengkap riwayat perubahan ada di CHANGELOG.md.
 */
contract SIEMLogger {
    /// @notice Versi kontrak, bisa ditampilkan di UI.
    string public constant VERSION = "3.0.0";

    // ---------------------------------------------------------------------
    // RBAC — Role-Based Access Control
    // ---------------------------------------------------------------------

    /// @notice Urutan enum WAJIB tetap (nilai tersimpan on-chain).
    ///         NONE = tanpa akses tulis, tapi tetap bisa membaca data publik.
    enum Role { NONE, AUDITOR, SOC_ANALYST, ADMIN }

    // ---------------------------------------------------------------------
    // Struktur data
    // ---------------------------------------------------------------------

    /// @dev `logHash` (string) + `timestamp` (uint256) masing-masing 1 slot.
    ///      `verifiedAt` + `isTampered` + `recordedBy` dipack jadi 1 slot
    ///      (8 + 1 + 20 = 29 byte) -> hemat gas vs 3 slot terpisah.
    struct LogEntry {
        string  logHash;     // hash SHA-256 asli (hex string) saat didaftarkan
        uint256 timestamp;   // kapan didaftarkan (block.timestamp)
        uint64  verifiedAt;  // kapan terakhir diverifikasi (0 = belum pernah)
        bool    isTampered;  // true kalau PERNAH terdeteksi tidak cocok
        address recordedBy;  // akun yang mendaftarkan entri ini
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Owner / super-admin (akun yang mendeploy). Tidak bisa dicabut.
    address public admin;

    /// @notice Jumlah akun ber-role ADMIN (read-only helper).
    uint256 public adminCount;

    /// @notice Role setiap alamat. Default = Role.NONE.
    mapping(address => Role) public roles;

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

    /// @notice Dipancarkan tiap kali verifikasi dijalankan (cocok atau tidak).
    event LogVerified(string indexed logId, string currentHash, bool isMatch, uint256 timestamp);

    /// @notice ⚠️ ALARM. Dipancarkan saat hash server != hash on-chain.
    ///         (signature dipertahankan sama seperti v1.0)
    event TamperingDetected(string indexed logId, string expectedHash, string actualHash);

    /// @notice Perubahan role (v3.0 — menggantikan AdminAdded/AdminRemoved).
    event RoleAssigned(address indexed account, Role role);
    event RoleRevoked(address indexed account, Role previousRole);

    /// @notice Dipertahankan dari v2.0 supaya listener lama tetap jalan.
    event AdminAdded(address indexed account);
    event AdminRemoved(address indexed account);

    // ---------------------------------------------------------------------
    // Custom errors — lebih murah dari `require` dengan string
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotAdmin();
    error NotOperator();      // butuh SOC_ANALYST atau ADMIN
    error InvalidAddress();
    error InvalidRole();
    error SameRole(address account, Role role);
    error CannotChangeOwner();
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

    /// @notice Butuh role ADMIN (boleh kelola role).
    modifier onlyAdmin() {
        if (roles[msg.sender] != Role.ADMIN) revert NotAdmin();
        _;
    }

    /// @notice Butuh SOC_ANALYST atau ADMIN (boleh menulis state log).
    modifier onlyOperator() {
        Role r = roles[msg.sender];
        if (r != Role.SOC_ANALYST && r != Role.ADMIN) revert NotOperator();
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() {
        admin = msg.sender;
        roles[msg.sender] = Role.ADMIN;
        _adminList.push(msg.sender);
        adminCount = 1;
        emit RoleAssigned(msg.sender, Role.ADMIN);
        emit AdminAdded(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Manajemen role (v3.0)
    // ---------------------------------------------------------------------

    /// @notice Set role sebuah akun. Hanya ADMIN yang boleh.
    ///         Owner sendiri tidak bisa diubah (CannotChangeOwner).
    function setRole(address _account, Role _role) public onlyAdmin {
        if (_account == address(0)) revert InvalidAddress();
        if (_account == admin) revert CannotChangeOwner();
        if (_role == Role.NONE) revert InvalidRole(); // pakai removeRole()

        Role old = roles[_account];
        if (old == _role) revert SameRole(_account, _role);

        _setRole(_account, old, _role);
    }

    /// @notice Cabut seluruh akses tulis sebuah akun (kembali jadi NONE).
    function removeRole(address _account) public onlyAdmin {
        if (_account == address(0)) revert InvalidAddress();
        if (_account == admin) revert CannotChangeOwner();

        Role old = roles[_account];
        if (old == Role.NONE) revert SameRole(_account, Role.NONE);

        _setRole(_account, old, Role.NONE);
    }

    /// @notice Alias dari setRole(account, ADMIN) — nama lama dari v2.0.
    function addAdmin(address _account) external onlyAdmin {
        setRole(_account, Role.ADMIN);
    }

    /// @notice Alias dari removeRole(account) — nama lama dari v2.0.
    function removeAdmin(address _account) external onlyAdmin {
        removeRole(_account);
    }

    /// @notice Shortcut: jadikan akun SOC Analyst.
    function addAnalyst(address _account) external onlyAdmin {
        setRole(_account, Role.SOC_ANALYST);
    }

    /// @notice Shortcut: jadikan akun Auditor (read-only).
    function addAuditor(address _account) external onlyAdmin {
        setRole(_account, Role.AUDITOR);
    }

    function _setRole(address _account, Role _old, Role _new) private {
        roles[_account] = _new;

        if (_old == Role.ADMIN) {
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

        if (_new == Role.ADMIN) {
            _adminList.push(_account);
            adminCount += 1;
            emit AdminAdded(_account);
        }

        if (_old != Role.NONE) emit RoleRevoked(_account, _old);
        emit RoleAssigned(_account, _new);
    }

    // ---------------------------------------------------------------------
    // Query role
    // ---------------------------------------------------------------------

    /// @notice Nama role dalam teks (untuk ditampilkan di dasbor SOC).
    function getRoleName(address _account) external view returns (string memory) {
        return _roleName(roles[_account]);
    }

    /// @notice true kalau akun ber-role ADMIN.
    function isAdmin(address _account) external view returns (bool) {
        return roles[_account] == Role.ADMIN;
    }

    /// @notice true kalau akun boleh menulis state log (ANALYST atau ADMIN).
    function isOperator(address _account) external view returns (bool) {
        Role r = roles[_account];
        return r == Role.SOC_ANALYST || r == Role.ADMIN;
    }

    /// @notice true kalau akun punya role apa pun (termasuk AUDITOR).
    function hasRole(address _account) external view returns (bool) {
        return roles[_account] != Role.NONE;
    }

    /// @notice Daftar semua akun ber-role ADMIN.
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
        onlyOperator
    {
        _record(_logId, _logHash);
    }

    /// @notice Impor banyak log sekaligus. Biaya dasar 1 transaksi (±21k gas)
    ///         dibagi ke semua item -> jauh lebih murah daripada satu-satu.
    function recordLogHashBatch(
        string[] calldata _ids,
        string[] calldata _hashes
    ) external onlyOperator {
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
    /// @dev    Butuh role SOC_ANALYST atau ADMIN, karena fungsi ini MENULIS
    ///         state. Untuk pengecekan gratis tanpa role, pakai
    ///         `verifyLogIntegrityView` (view, boleh siapa saja).
    /// @return true kalau hash masih cocok (log aman), false kalau di-tamper.
    function verifyLogIntegrity(
        string calldata _logId,
        string calldata _currentServerHash
    ) external onlyOperator returns (bool) {
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

    /// @notice Versi GRATIS (view) dari verifikasi — tidak mengubah state,
    ///         tidak butuh gas, dan TIDAK butuh role (publik/AUDITOR boleh).
    ///         Cocok dipanggil frontend/backend berulang kali untuk
    ///         menampilkan status "AMAN / TAMPERED" secara real-time.
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

    /// @notice Versi lengkap dari getLogStatus (termasuk field v2.0).
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
    // Helper listing — supaya UI bisa menampilkan semua log
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

    function _roleName(Role _role) private pure returns (string memory) {
        if (_role == Role.ADMIN) return "ADMIN";
        if (_role == Role.SOC_ANALYST) return "SOC_ANALYST";
        if (_role == Role.AUDITOR) return "AUDITOR";
        return "NONE";
    }
}
