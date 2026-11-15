// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SIEMLogger {
    string public constant VERSION = "4.0.0";

    enum Role { NONE, AUDITOR, SOC_ANALYST, ADMIN }

    struct LogEntry {
        string  logHash;
        uint256 timestamp;
        uint64  verifiedAt;
        bool    isTampered;
        address recordedBy;
    }

    struct Asset {
        string  name;
        string  category;
        string  location;
        uint64  createdAt;
        uint64  updatedAt;
        bool    exists;
        address createdBy;
        address updatedBy;
    }

    address public admin;

    uint256 public adminCount;

    mapping(address => Role) public roles;

    mapping(string => LogEntry) public logs;

    mapping(string => Asset) private _assets;

    address[] private _adminList;
    string[]  private _logIds;
    string[]  private _assetIds;
    mapping(string => uint256) private _assetIndex;

    event LogRecorded(string logId, string logHash, uint256 timestamp);

    event LogVerified(string logId, string currentHash, bool isMatch, uint256 timestamp);

    event TamperingDetected(string logId, string expectedHash, string actualHash);

    event AssetCreated(string assetId, string name, string category, address by, uint256 timestamp);
    event AssetUpdated(string assetId, string name, string category, address by, uint256 timestamp);
    event AssetDeleted(string assetId, address by, uint256 timestamp);

    event RoleAssigned(address indexed account, Role role);
    event RoleRevoked(address indexed account, Role previousRole);

    event AdminAdded(address indexed account);
    event AdminRemoved(address indexed account);

    error NotOwner();
    error NotAdmin();
    error NotOperator();
    error InvalidAddress();
    error InvalidRole();
    error SameRole(address account, Role role);
    error CannotChangeOwner();
    error LogAlreadyExists(string logId);
    error LogNotFound(string logId);
    error EmptyHash();
    error LengthMismatch();
    error EmptyId();
    error EmptyName();
    error AssetAlreadyExists(string assetId);
    error AssetNotFound(string assetId);

    modifier onlyOwner() {
        if (msg.sender != admin) revert NotOwner();
        _;
    }

    modifier onlyAdmin() {
        if (roles[msg.sender] != Role.ADMIN) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        Role r = roles[msg.sender];
        if (r != Role.SOC_ANALYST && r != Role.ADMIN) revert NotOperator();
        _;
    }

    constructor() {
        admin = msg.sender;
        roles[msg.sender] = Role.ADMIN;
        _adminList.push(msg.sender);
        adminCount = 1;
        emit RoleAssigned(msg.sender, Role.ADMIN);
        emit AdminAdded(msg.sender);
    }

    function setRole(address _account, Role _role) public onlyAdmin {
        if (_account == address(0)) revert InvalidAddress();
        if (_account == admin) revert CannotChangeOwner();
        if (_role == Role.NONE) revert InvalidRole();

        Role old = roles[_account];
        if (old == _role) revert SameRole(_account, _role);

        _setRole(_account, old, _role);
    }

    function removeRole(address _account) public onlyAdmin {
        if (_account == address(0)) revert InvalidAddress();
        if (_account == admin) revert CannotChangeOwner();

        Role old = roles[_account];
        if (old == Role.NONE) revert SameRole(_account, Role.NONE);

        _setRole(_account, old, Role.NONE);
    }

    function addAdmin(address _account) external onlyAdmin {
        setRole(_account, Role.ADMIN);
    }

    function removeAdmin(address _account) external onlyAdmin {
        removeRole(_account);
    }

    function addAnalyst(address _account) external onlyAdmin {
        setRole(_account, Role.SOC_ANALYST);
    }

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

    function getRoleName(address _account) external view returns (string memory) {
        return _roleName(roles[_account]);
    }

    function isAdmin(address _account) external view returns (bool) {
        return roles[_account] == Role.ADMIN;
    }

    function isOperator(address _account) external view returns (bool) {
        Role r = roles[_account];
        return r == Role.SOC_ANALYST || r == Role.ADMIN;
    }

    function hasRole(address _account) external view returns (bool) {
        return roles[_account] != Role.NONE;
    }

    function getAdmins() external view returns (address[] memory) {
        return _adminList;
    }

    function recordLogHash(string calldata _logId, string calldata _logHash)
        external
        onlyOperator
    {
        _record(_logId, _logHash);
    }

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

    function verifyLogIntegrityView(
        string calldata _logId,
        string calldata _currentServerHash
    ) external view returns (bool) {
        string memory originalHash = logs[_logId].logHash;
        if (bytes(originalHash).length == 0) revert LogNotFound(_logId);
        return _hashesEqual(originalHash, _currentServerHash);
    }

    function getLogStatus(string calldata _logId)
        external
        view
        returns (string memory, uint256, bool)
    {
        LogEntry storage entry = logs[_logId];
        if (bytes(entry.logHash).length == 0) revert LogNotFound(_logId);
        return (entry.logHash, entry.timestamp, entry.isTampered);
    }

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

    function getLogCount() external view returns (uint256) {
        return _logIds.length;
    }

    function getLogIds() external view returns (string[] memory) {
        return _logIds;
    }

    function getLogIdAt(uint256 _index) external view returns (string memory) {
        return _logIds[_index];
    }

    function createAsset(
        string calldata _assetId,
        string calldata _name,
        string calldata _category,
        string calldata _location
    ) external onlyOperator {
        if (bytes(_assetId).length == 0) revert EmptyId();
        if (bytes(_name).length == 0) revert EmptyName();
        if (_assets[_assetId].exists) revert AssetAlreadyExists(_assetId);

        _assets[_assetId] = Asset({
            name: _name,
            category: _category,
            location: _location,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            exists: true,
            createdBy: msg.sender,
            updatedBy: msg.sender
        });

        _assetIds.push(_assetId);
        _assetIndex[_assetId] = _assetIds.length;

        emit AssetCreated(_assetId, _name, _category, msg.sender, block.timestamp);
    }

    function updateAsset(
        string calldata _assetId,
        string calldata _name,
        string calldata _category,
        string calldata _location
    ) external onlyOperator {
        Asset storage a = _assets[_assetId];
        if (!a.exists) revert AssetNotFound(_assetId);
        if (bytes(_name).length == 0) revert EmptyName();

        a.name = _name;
        a.category = _category;
        a.location = _location;
        a.updatedAt = uint64(block.timestamp);
        a.updatedBy = msg.sender;

        emit AssetUpdated(_assetId, _name, _category, msg.sender, block.timestamp);
    }

    function deleteAsset(string calldata _assetId) external onlyAdmin {
        if (!_assets[_assetId].exists) revert AssetNotFound(_assetId);

        delete _assets[_assetId];

        uint256 idx = _assetIndex[_assetId];
        uint256 len = _assetIds.length;
        if (idx != 0 && idx <= len) {
            _assetIds[idx - 1] = _assetIds[len - 1];
            _assetIndex[_assetIds[idx - 1]] = idx;
            _assetIds.pop();
        }
        delete _assetIndex[_assetId];

        emit AssetDeleted(_assetId, msg.sender, block.timestamp);
    }

    function getAsset(string calldata _assetId)
        external
        view
        returns (
            string memory name,
            string memory category,
            string memory location,
            uint64 createdAt,
            uint64 updatedAt,
            address createdBy,
            address updatedBy
        )
    {
        Asset storage a = _assets[_assetId];
        if (!a.exists) revert AssetNotFound(_assetId);
        return (a.name, a.category, a.location, a.createdAt, a.updatedAt, a.createdBy, a.updatedBy);
    }

    function assetExists(string calldata _assetId) external view returns (bool) {
        return _assets[_assetId].exists;
    }

    function getAssetCount() external view returns (uint256) {
        return _assetIds.length;
    }

    function getAssetIds() external view returns (string[] memory) {
        return _assetIds;
    }

    function getAssetIdAt(uint256 _index) external view returns (string memory) {
        return _assetIds[_index];
    }

    function canManageAssets(address _account) external view returns (bool) {
        Role r = roles[_account];
        return r == Role.SOC_ANALYST || r == Role.ADMIN;
    }

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
