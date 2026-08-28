// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title KinnVault
/// @notice Per-owner inheritance vault instance deployed by KinnVaultFactory.
/// @dev Self-contained storage per instance. The factory is the only deployer and records the
///      owner -> vault mapping. Owner-authorization and inheritance eligibility are enforced
///      on-chain; the backend/keeper can never move funds or alter protected configuration.
///      Asset set: native ETH (represented by ETH_SENTINEL) and ERC-20 tokens (initial: USDC).
contract KinnVault {
    // ---- Constants -------------------------------------------------------
    uint64 public constant MAX_CHECK_IN_INTERVAL = 9 weeks;
    uint8 public constant MAX_MISSED_CHECK_INS = 5;
    uint16 public constant TOTAL_ALLOCATION_BPS = 10_000;
    uint16 public constant MAX_BENEFICIARIES = 50;
    /// @notice Sentinel representing native ETH as a uniform asset in tracking/distribution.
    address public constant ETH_SENTINEL = 0x1111111111111111111111111111111111111111;
    uint256 private constant TRANSFER_GAS_LIMIT = 200_000;

    // ---- Immutables ------------------------------------------------------
    address public immutable factory;
    address public immutable owner;
    uint256 public immutable automationFeeWei;

    // ---- Inheritance state machine ---------------------------------------
    enum InheritanceState { Active, Missed, Eligible, Distributing, Distributed, Closed }

    struct Beneficiary {
        address account;
        uint16 allocationBps;
    }

    // ---- Vault state -----------------------------------------------------
    bool public closed;
    bool public inheritanceTriggered;
    uint64 public lastCheckIn;
    uint64 public checkInInterval;
    uint8 public maxMissedCheckIns;
    uint128 public automationReserve;
    uint256 public processedAssetCount;
    bool private _entered;

    Beneficiary[] public beneficiaries;
    address[] private _trackedAssets; // ETH_SENTINEL or ERC-20 addresses
    mapping(address => bool) private _assetTracked;
    mapping(address => bool) public inheritanceAssetProcessed;
    // token => beneficiary => pending amount / retry time
    mapping(address => mapping(address => uint256)) public pendingInheritance;
    mapping(address => mapping(address => uint256)) public nextDistributionRetry;
    uint16 private _pendingCount;

    // ---- Errors ----------------------------------------------------------
    error NotOwner(address caller);
    error OnlySelf();
    error VaultIsClosed(address owner);
    error VaultInactive(address owner);
    error NotConfigurable(address owner);
    error InvalidCheckInInterval(uint64 interval);
    error InvalidMaxMissedCheckIns(uint8 value);
    error BeneficiariesRequired();
    error TooManyBeneficiaries(uint256 provided, uint256 maximum);
    error BeneficiaryArrayLengthMismatch();
    error InvalidBeneficiary(address account);
    error DuplicateBeneficiary(address account);
    error InvalidAllocation(uint16 allocationBps);
    error InvalidTotalAllocation(uint256 totalAllocationBps);
    error InvalidToken(address token);
    error UnknownAsset(address asset);
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error TokenTransferFailed(address token);
    error TokenBalanceInvariant(address token);
    error NativeTransferFailed(address recipient, uint256 amount);
    error EtherTransferFailed();
    error Reentrancy();
    error InheritanceAlreadyTriggered();
    error InheritanceNotEligible();
    error InheritanceNotTriggered();
    error AssetAlreadyProcessed(address asset);
    error NoPendingInheritance(address asset, address beneficiary);
    error RetryNotReady(uint256 nextRetryAt);
    error InheritanceIncomplete();
    error ReserveOverflow();
    error InsufficientAutomationReserve(uint256 available, uint256 requested);
    error VaultHasAssets(address asset, uint256 balance);
    error VaultHasAutomationReserve(uint256 balance);
    error InvalidAddress();
// ---- Events ----------------------------------------------------------
    event VaultInitialized(
        address indexed owner,
        uint64 checkInInterval,
        uint8 maxMissedCheckIns,
        uint64 lastCheckIn
    );
    event VaultSettingsUpdated(address indexed owner, uint64 checkInInterval, uint8 maxMissedCheckIns);
    event BeneficiariesUpdated(address indexed owner, address[] accounts, uint16[] allocationsBps);
    event AssetDeposited(address indexed owner, address indexed token, uint256 amount);
    event EthDeposited(address indexed owner, uint256 amount);
    event AssetWithdrawn(address indexed owner, address indexed token, uint256 amount);
    event EthWithdrawn(address indexed owner, uint256 amount);
    event CheckedIn(address indexed owner, uint64 timestamp);
    event VaultClosed(address indexed owner);
    event InheritanceTriggered(address indexed owner, address indexed executor, uint64 timestamp);
    event InheritanceAssetProcessed(address indexed owner, address indexed asset, uint256 amount);
    event InheritanceDistributed(
        address indexed owner, address indexed asset, address indexed beneficiary, uint256 amount
    );
    event InheritanceDistributionFailed(
        address indexed owner, address indexed asset, address indexed beneficiary, uint256 amount, uint256 nextRetryAt
    );
    event AutomationReserveToppedUp(address indexed owner, uint256 amount, uint256 newBalance);
    event AutomationReserveWithdrawn(address indexed owner, uint256 amount, uint256 newBalance);
    event AutomationFeePaid(address indexed owner, address indexed caller, uint256 amount, uint256 remaining);

    // ---- Modifiers --------------------------------------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Only deployable by the factory. Sets ownership and initial inheritance config.
    constructor(
        address _factory,
        address _owner,
        uint64 _checkInInterval,
        uint8 _maxMissedCheckIns,
        address[] memory _accounts,
        uint16[] memory _allocationsBps,
        uint256 _automationFeeWei
    ) {
        if (_factory == address(0)) revert InvalidAddress();
        factory = _factory;
        owner = _owner;
        automationFeeWei = _automationFeeWei;
        _validateSettings(_checkInInterval, _maxMissedCheckIns);
        checkInInterval = _checkInInterval;
        maxMissedCheckIns = _maxMissedCheckIns;
        lastCheckIn = uint64(block.timestamp);
        _replaceBeneficiaries(_accounts, _allocationsBps);
        emit VaultInitialized(_owner, _checkInInterval, _maxMissedCheckIns, lastCheckIn);
    }
// ---- Owner: configuration --------------------------------------------

    /// @notice Updates check-in interval and missed-check-in limit.
    function updateSettings(uint64 _checkInInterval, uint8 _maxMissedCheckIns) external onlyOwner {
        _requireConfigurable();
        _validateSettings(_checkInInterval, _maxMissedCheckIns);
        checkInInterval = _checkInInterval;
        maxMissedCheckIns = _maxMissedCheckIns;
        emit VaultSettingsUpdated(owner, _checkInInterval, _maxMissedCheckIns);
    }

    /// @notice Replaces the beneficiary list (exact 100% allocation enforced).
    function updateBeneficiaries(address[] calldata _accounts, uint16[] calldata _allocationsBps)
        external
        onlyOwner
    {
        _requireConfigurable();
        _replaceBeneficiaries(_accounts, _allocationsBps);
    }

    /// @notice Resets the dead-man-switch clock (full reset, no partial credit).
    function checkIn() external onlyOwner {
        if (inheritanceTriggered || closed) revert VaultInactive(owner);
        lastCheckIn = uint64(block.timestamp);
        emit CheckedIn(owner, lastCheckIn);
    }

    /// @notice Permanently closes an empty, active vault. Owner may create a new vault via the factory.
    function closeVault() external onlyOwner {
        if (inheritanceTriggered) revert VaultInactive(owner);
        uint256 length = _trackedAssets.length;
        for (uint256 i; i < length; ++i) {
            address asset = _trackedAssets[i];
            uint256 balance = _assetBalance(asset);
            if (balance != 0) revert VaultHasAssets(asset, balance);
        }
        if (automationReserve != 0) revert VaultHasAutomationReserve(automationReserve);
        closed = true;
        delete _trackedAssets;
        delete beneficiaries;
        emit VaultClosed(owner);
    }

    // ---- Owner: assets ----------------------------------------------------

    /// @notice Deposits a supported ERC-20 (initial asset set: USDC). Fee-on-transfer is rejected.
    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || token == ETH_SENTINEL) revert InvalidToken(token);
        if (amount == 0) revert InvalidAmount();
        _requireConfigurable();
        uint256 before = _erc20Balance(token);
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 received = _erc20Balance(token) - before;
        if (received == 0) revert TokenTransferFailed(token);
        _recordAsset(token);
        emit AssetDeposited(owner, token, received);
    }

    /// @notice Deposits native ETH into the vault as a protected asset.
    function depositETH() external payable onlyOwner nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        _requireConfigurable();
        _recordAsset(ETH_SENTINEL);
        emit EthDeposited(owner, msg.value);
    }

    /// @notice Withdraws ERC-20 or native ETH (ETH_SENTINEL) back to the owner's wallet.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        _requireConfigurable();
        _withdrawAsset(token, amount);
    }

    function topUpAutomationReserve() external payable onlyOwner {
        if (msg.value == 0) revert InvalidAmount();
        _requireConfigurable();
        automationReserve = _toUint128(uint256(automationReserve) + msg.value);
        emit AutomationReserveToppedUp(owner, msg.value, automationReserve);
    }

    function withdrawAutomationReserve(uint256 amount) external onlyOwner nonReentrant {
        _requireConfigurable();
        if (amount == 0 || amount > automationReserve) {
            revert InsufficientAutomationReserve(automationReserve, amount);
        }
        automationReserve = _toUint128(uint256(automationReserve) - amount);
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert NativeTransferFailed(msg.sender, amount);
        emit AutomationReserveWithdrawn(owner, amount, automationReserve);
    }
// ---- Inheritance (permissionless; contract validates eligibility) ----

    /// @notice Permanently triggers inheritance once eligible.
    function triggerInheritance() external nonReentrant {
        if (closed) revert VaultIsClosed(owner);
        if (inheritanceTriggered) revert InheritanceAlreadyTriggered();
        if (state() != InheritanceState.Eligible) revert InheritanceNotEligible();
        inheritanceTriggered = true;
        emit InheritanceTriggered(owner, msg.sender, uint64(block.timestamp));
        _payAutomationFee();
    }

    /// @notice Snapshots and distributes one asset after inheritance is triggered.
    function distributeInheritanceAsset(address asset) external nonReentrant {
        if (closed) revert VaultIsClosed(owner);
        if (!inheritanceTriggered) revert InheritanceNotTriggered();
        if (!_assetTracked[asset]) revert UnknownAsset(asset);
        if (inheritanceAssetProcessed[asset]) revert AssetAlreadyProcessed(asset);

        inheritanceAssetProcessed[asset] = true;
        processedAssetCount += 1;
        uint256 amount = _assetBalance(asset);
        emit InheritanceAssetProcessed(owner, asset, amount);
        if (amount != 0) _distributeAsset(asset, amount);
        _payAutomationFee();
    }

    /// @notice Retries one failed entitlement after the retry interval has elapsed.
    function retryInheritanceDistribution(address asset, address beneficiary) external nonReentrant {
        if (closed) revert VaultIsClosed(owner);
        uint256 amount = pendingInheritance[asset][beneficiary];
        if (amount == 0) revert NoPendingInheritance(asset, beneficiary);
        uint256 retryAt = nextDistributionRetry[asset][beneficiary];
        if (block.timestamp < retryAt) revert RetryNotReady(retryAt);
        if (_tryTransfer(asset, beneficiary, amount)) {
            delete pendingInheritance[asset][beneficiary];
            delete nextDistributionRetry[asset][beneficiary];
            _pendingCount -= 1;
            emit InheritanceDistributed(owner, asset, beneficiary, amount);
        } else {
            nextDistributionRetry[asset][beneficiary] = block.timestamp + checkInInterval;
            emit InheritanceDistributionFailed(
                owner, asset, beneficiary, amount, nextDistributionRetry[asset][beneficiary]
            );
        }
    }

    /// @notice Claims unused automation reserve once distribution is fully complete. Relayer incentive.
    function claimAutomationReserve() external nonReentrant {
        if (closed) revert VaultIsClosed(owner);
        if (!inheritanceTriggered) revert InheritanceNotTriggered();
        if (processedAssetCount != _trackedAssets.length || _pendingCount != 0) revert InheritanceIncomplete();
        uint256 amount = automationReserve;
        if (amount == 0) revert InvalidAmount();
        automationReserve = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert NativeTransferFailed(msg.sender, amount);
        emit AutomationFeePaid(owner, msg.sender, amount, 0);
    }
// ---- Views ------------------------------------------------------------

    /// @notice Derived, authoritative state per the documented state machine.
    function state() public view returns (InheritanceState) {
        if (closed) return InheritanceState.Closed;
        if (inheritanceTriggered) {
            return (processedAssetCount == _trackedAssets.length && _pendingCount == 0)
                ? InheritanceState.Distributed
                : InheritanceState.Distributing;
        }
        if (block.timestamp >= _eligibleAt()) return InheritanceState.Eligible;
        if (block.timestamp > lastCheckIn + checkInInterval) return InheritanceState.Missed;
        return InheritanceState.Active;
    }

    function inheritanceEligible() external view returns (bool) {
        return state() == InheritanceState.Eligible;
    }

    /// @notice The timestamp at which inheritance becomes eligible (pinned formula).
    function eligibilityDeadline() external view returns (uint256) {
        return _eligibleAt();
    }

    function nextExpectedCheckIn() external view returns (uint256) {
        return uint256(lastCheckIn) + uint256(checkInInterval);
    }

    function missedCheckIns() public view returns (uint8) {
        if (inheritanceTriggered || closed || block.timestamp <= lastCheckIn) return 0;
        uint256 missed = (block.timestamp - lastCheckIn) / checkInInterval;
        if (missed > maxMissedCheckIns) return maxMissedCheckIns;
        return uint8(missed);
    }

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        return beneficiaries;
    }

    function getTrackedAssets() external view returns (address[] memory) {
        return _trackedAssets;
    }

    /// @notice Current protected balance of an asset (live, never cached).
    function protectedAssetBalance(address asset) external view returns (uint256) {
        return _assetBalance(asset);
    }

    // ---- Internal ---------------------------------------------------------

    function _requireConfigurable() private view {
        if (closed) revert VaultIsClosed(owner);
        if (inheritanceTriggered) revert VaultInactive(owner);
        InheritanceState s = state();
        if (s != InheritanceState.Active && s != InheritanceState.Missed) revert NotConfigurable(owner);
    }

    function _validateSettings(uint64 _checkInInterval, uint8 _maxMissedCheckIns) private pure {
        if (_checkInInterval == 0 || _checkInInterval > MAX_CHECK_IN_INTERVAL) {
            revert InvalidCheckInInterval(_checkInInterval);
        }
        if (_maxMissedCheckIns == 0 || _maxMissedCheckIns > MAX_MISSED_CHECK_INS) {
            revert InvalidMaxMissedCheckIns(_maxMissedCheckIns);
        }
    }

    function _replaceBeneficiaries(address[] memory _accounts, uint16[] memory _allocationsBps) private {
        uint256 length = _accounts.length;
        if (length == 0) revert BeneficiariesRequired();
        if (length > MAX_BENEFICIARIES) revert TooManyBeneficiaries(length, MAX_BENEFICIARIES);
        if (length != _allocationsBps.length) revert BeneficiaryArrayLengthMismatch();

        uint256 totalAllocation;
        for (uint256 i; i < length; ++i) {
            address account = _accounts[i];
            uint16 allocation = _allocationsBps[i];
            if (account == address(0)) revert InvalidBeneficiary(account);
            if (allocation == 0) revert InvalidAllocation(allocation);
            for (uint256 j; j < i; ++j) {
                if (_accounts[j] == account) revert DuplicateBeneficiary(account);
            }
            totalAllocation += allocation;
        }
        if (totalAllocation != TOTAL_ALLOCATION_BPS) revert InvalidTotalAllocation(totalAllocation);

        delete beneficiaries;
        for (uint256 i; i < length; ++i) {
            beneficiaries.push(Beneficiary({account: _accounts[i], allocationBps: _allocationsBps[i]}));
        }
        emit BeneficiariesUpdated(owner, _accounts, _allocationsBps);
    }
function _withdrawAsset(address token, uint256 amount) private {
        if (amount == 0) revert InvalidAmount();
        if (token == ETH_SENTINEL) {
            uint256 available = _assetBalance(ETH_SENTINEL);
            if (amount > available) revert InsufficientBalance(available, amount);
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert NativeTransferFailed(msg.sender, amount);
            emit EthWithdrawn(owner, amount);
        } else {
            if (token == address(0)) revert InvalidToken(token);
            uint256 available = _erc20Balance(token);
            if (amount > available) revert InsufficientBalance(available, amount);
            _safeTransfer(token, msg.sender, amount);
            emit AssetWithdrawn(owner, token, amount);
        }
    }

    function _recordAsset(address asset) private {
        if (_assetTracked[asset]) return;
        _assetTracked[asset] = true;
        _trackedAssets.push(asset);
    }

    /// @notice Pinned eligibility formula: lastCheckIn + interval * maxMissedCheckIns.
    function _eligibleAt() private view returns (uint256) {
        return uint256(lastCheckIn) + uint256(checkInInterval) * uint256(maxMissedCheckIns);
    }

    function _assetBalance(address asset) private view returns (uint256) {
        if (asset == ETH_SENTINEL) {
            uint256 balance = address(this).balance;
            return balance > automationReserve ? balance - automationReserve : 0;
        }
        return _erc20Balance(asset);
    }

    /// @notice Splits an amount into per-beneficiary amounts, paying the remainder to the last.
    function _splitAllocation(uint256 amount)
        private
        view
        returns (address[] memory accounts, uint256[] memory amounts)
    {
        uint256 count = beneficiaries.length;
        accounts = new address[](count);
        amounts = new uint256[](count);
        uint256 allocated;
        for (uint256 i; i < count; ++i) {
            address account = beneficiaries[i].account;
            uint256 share;
            if (i == count - 1) {
                share = amount - allocated;
            } else {
                share = amount * beneficiaries[i].allocationBps / TOTAL_ALLOCATION_BPS;
                allocated += share;
            }
            accounts[i] = account;
            amounts[i] = share;
        }
    }

    function _distributeAsset(address asset, uint256 amount) private {
        (address[] memory accounts, uint256[] memory amounts) = _splitAllocation(amount);
        for (uint256 i; i < accounts.length; ++i) {
            uint256 entitlement = amounts[i];
            if (entitlement == 0) continue;
            pendingInheritance[asset][accounts[i]] = entitlement;
            _pendingCount += 1;
            _attemptDistribution(asset, accounts[i], entitlement);
        }
    }

    function _attemptDistribution(address asset, address beneficiary, uint256 amount) private {
        if (_tryTransfer(asset, beneficiary, amount)) {
            delete pendingInheritance[asset][beneficiary];
            delete nextDistributionRetry[asset][beneficiary];
            _pendingCount -= 1;
            emit InheritanceDistributed(owner, asset, beneficiary, amount);
        } else {
            uint256 nextRetry = block.timestamp + checkInInterval;
            nextDistributionRetry[asset][beneficiary] = nextRetry;
            emit InheritanceDistributionFailed(owner, asset, beneficiary, amount, nextRetry);
        }
    }

    function _tryTransfer(address asset, address to, uint256 amount) private returns (bool) {
        if (asset == ETH_SENTINEL) {
            (bool okEth,) = address(this).call{gas: TRANSFER_GAS_LIMIT}(
                abi.encodeCall(this.attemptEtherTransfer, (to, amount))
            );
            return okEth;
        }
        (bool okToken,) = address(this).call{gas: TRANSFER_GAS_LIMIT}(
            abi.encodeCall(this.attemptTokenTransfer, (asset, to, amount))
        );
        return okToken;
    }

    /// @dev Isolated subcall: a false/reverting ETH recipient rolls back so the entitlement stays pending.
    function attemptEtherTransfer(address to, uint256 amount) external onlySelf {
        if (amount > address(this).balance) revert EtherTransferFailed();
        (bool success,) = to.call{value: amount}("");
        if (!success) revert EtherTransferFailed();
    }

    /// @dev Isolated subcall: exact-balance invariant; false/revert stays pending.
    function attemptTokenTransfer(address token, address to, uint256 amount) external onlySelf {
        uint256 before = _erc20Balance(token);
        _safeTransfer(token, to, amount);
        uint256 afterBalance = _erc20Balance(token);
        if (afterBalance != before - amount) revert TokenBalanceInvariant(token);
    }

    function _payAutomationFee() private {
        uint256 reserve = automationReserve;
        if (reserve == 0) return;
        uint256 fee = reserve < automationFeeWei ? reserve : automationFeeWei;
        if (fee == 0) return;
        automationReserve = _toUint128(reserve - fee);
        (bool success,) = msg.sender.call{value: fee}("");
        if (!success) {
            automationReserve = _toUint128(reserve);
            return;
        }
        emit AutomationFeePaid(owner, msg.sender, fee, reserve - fee);
    }

    function _erc20Balance(address token) private view returns (uint256 value) {
        (bool success, bytes memory data) =
            token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!success || data.length < 32) revert TokenTransferFailed(token);
        value = abi.decode(data, (uint256));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        _callOptionalReturn(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        _callOptionalReturn(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
    }

    function _callOptionalReturn(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && (result.length < 32 || !abi.decode(result, (bool))))) {
            revert TokenTransferFailed(token);
        }
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert ReserveOverflow();
        return uint128(value);
    }
}
