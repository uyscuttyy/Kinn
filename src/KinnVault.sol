// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title KinnVault
/// @notice Foundation for non-custodial inheritance vault configuration.
/// @dev ERC-20 vault accounting, check-ins, and retryable inheritance distribution are implemented on-chain.
contract KinnVault {
    uint64 public constant MAX_CHECK_IN_INTERVAL = 9 weeks;
    uint8 public constant MAX_MISSED_CHECK_INS = 5;
    uint16 public constant TOTAL_ALLOCATION_BPS = 10_000;
    uint16 public constant MAX_BENEFICIARIES = 50;
    uint256 public immutable automationFeeWei;
    uint256 private constant TOKEN_TRANSFER_GAS_LIMIT = 200_000;

    struct Vault {
        address owner;
        uint64 lastCheckIn;
        uint64 checkInInterval;
        uint8 maxMissedCheckIns;
        bool active;
        bool inheritanceTriggered;
        uint128 automationReserve;
    }

    struct Beneficiary {
        address account;
        uint16 allocationBps;
    }

    mapping(address owner => Vault vault) private _vaults;
    mapping(address owner => Beneficiary[] beneficiaries) private _beneficiaries;
    mapping(address owner => mapping(address token => uint256)) private _tokenBalances;
    mapping(address owner => address[]) private _vaultTokens;
    mapping(address owner => mapping(address token => bool)) private _knownToken;
    mapping(address owner => mapping(address token => mapping(address beneficiary => uint256))) private
        _pendingInheritance;
    mapping(address owner => mapping(address token => mapping(address beneficiary => uint256))) private
        _nextDistributionRetry;
    mapping(address owner => mapping(address token => bool)) private _inheritanceTokenProcessed;
    mapping(address owner => uint256) private _processedTokenCount;
    mapping(address owner => uint256) private _pendingDistributionCount;
    bool private _entered;

    error VaultAlreadyExists(address owner);
    error VaultNotFound(address owner);
    error InvalidCheckInInterval(uint64 interval);
    error InvalidMaxMissedCheckIns(uint8 value);
    error BeneficiariesRequired();
    error BeneficiaryArrayLengthMismatch();
    error InvalidBeneficiary(address account);
    error DuplicateBeneficiary(address account);
    error InvalidAllocation(uint16 allocationBps);
    error InvalidTotalAllocation(uint256 totalAllocationBps);
    error InvalidToken(address token);
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error TokenTransferFailed(address token);
    error Reentrancy();
    error VaultHasAssets(address token, uint256 balance);
    error VaultHasAutomationReserve(uint256 balance);
    error VaultInactive(address owner);
    error InheritanceNotEligible(address owner);
    error InheritanceAlreadyTriggered(address owner);
    error NoPendingInheritance(address owner, address token, address beneficiary);
    error RetryNotReady(uint256 nextRetryAt);
    error TooManyBeneficiaries(uint256 provided, uint256 maximum);
    error InheritanceNotTriggered(address owner);
    error InheritanceTokenAlreadyProcessed(address owner, address token);
    error OnlySelf();
    error TokenBalanceInvariant(address token);
    error ReserveOverflow();
    error InsufficientAutomationReserve(uint256 available, uint256 requested);
    error NativeTransferFailed(address recipient, uint256 amount);
    error InheritanceIncomplete(address owner);

    event VaultCreated(address indexed owner, uint64 checkInInterval, uint8 maxMissedCheckIns, uint64 lastCheckIn);
    event VaultSettingsUpdated(address indexed owner, uint64 checkInInterval, uint8 maxMissedCheckIns);
    event BeneficiariesUpdated(address indexed owner, address[] accounts, uint16[] allocationsBps);
    event AssetDeposited(address indexed owner, address indexed token, uint256 amount);
    event AssetWithdrawn(address indexed owner, address indexed token, uint256 amount);
    event VaultClosed(address indexed owner);
    event CheckedIn(address indexed owner, uint64 timestamp);
    event InheritanceTriggered(address indexed owner, address indexed executor, uint64 timestamp);
    event InheritanceDistributed(
        address indexed owner, address indexed token, address indexed beneficiary, uint256 amount
    );
    event InheritanceDistributionFailed(
        address indexed owner, address indexed token, address indexed beneficiary, uint256 amount, uint256 nextRetryAt
    );
    event InheritanceTokenProcessed(address indexed owner, address indexed token, uint256 amount);
    event AutomationReserveToppedUp(address indexed owner, uint256 amount, uint256 newBalance);
    event AutomationReserveWithdrawn(address indexed owner, uint256 amount, uint256 newBalance);
    event AutomationFeePaid(address indexed owner, address indexed caller, uint256 amount, uint256 remaining);

    constructor(uint256 automationFee) {
        automationFeeWei = automationFee;
    }

    /// @notice Creates the caller's vault and initial beneficiary configuration.
    function createVault(
        uint64 checkInInterval,
        uint8 maxMissedCheckIns,
        address[] calldata accounts,
        uint16[] calldata allocationsBps
    ) external payable {
        if (_vaults[msg.sender].owner != address(0)) {
            revert VaultAlreadyExists(msg.sender);
        }

        _validateSettings(checkInInterval, maxMissedCheckIns);
        _replaceBeneficiaries(msg.sender, accounts, allocationsBps);

        uint64 currentTimestamp = uint64(block.timestamp);
        _vaults[msg.sender] = Vault({
            owner: msg.sender,
            lastCheckIn: currentTimestamp,
            checkInInterval: checkInInterval,
            maxMissedCheckIns: maxMissedCheckIns,
            active: true,
            inheritanceTriggered: false,
            automationReserve: _toUint128(msg.value)
        });

        emit VaultCreated(msg.sender, checkInInterval, maxMissedCheckIns, currentTimestamp);
        if (msg.value != 0) emit AutomationReserveToppedUp(msg.sender, msg.value, msg.value);
    }

    /// @notice Updates timing settings for the caller's vault.
    function updateSettings(uint64 checkInInterval, uint8 maxMissedCheckIns) external {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);

        _validateSettings(checkInInterval, maxMissedCheckIns);
        vault.checkInInterval = checkInInterval;
        vault.maxMissedCheckIns = maxMissedCheckIns;

        emit VaultSettingsUpdated(msg.sender, checkInInterval, maxMissedCheckIns);
    }

    /// @notice Replaces the beneficiary configuration for the caller's vault.
    function updateBeneficiaries(address[] calldata accounts, uint16[] calldata allocationsBps) external {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) {
            revert VaultNotFound(msg.sender);
        }
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);

        _replaceBeneficiaries(msg.sender, accounts, allocationsBps);
    }

    /// @notice Deposits ERC-20 tokens into the caller's vault.
    function deposit(address token, uint256 amount) external nonReentrant {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);
        if (token == address(0)) revert InvalidToken(token);
        if (amount == 0) revert InvalidAmount();

        uint256 beforeBalance = _erc20Balance(token);
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 received = _erc20Balance(token) - beforeBalance;
        if (received == 0) revert TokenTransferFailed(token);

        _tokenBalances[msg.sender][token] += received;
        if (!_knownToken[msg.sender][token]) {
            _knownToken[msg.sender][token] = true;
            _vaultTokens[msg.sender].push(token);
        }
        emit AssetDeposited(msg.sender, token, received);
    }

    /// @notice Withdraws ERC-20 tokens from the caller's vault.
    function withdraw(address token, uint256 amount) external nonReentrant {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);
        if (token == address(0)) revert InvalidToken(token);
        if (amount == 0) revert InvalidAmount();

        uint256 balance = _tokenBalances[msg.sender][token];
        if (amount > balance) revert InsufficientBalance(balance, amount);
        _tokenBalances[msg.sender][token] = balance - amount;
        _safeTransfer(token, msg.sender, amount);
        emit AssetWithdrawn(msg.sender, token, amount);
    }

    function topUpAutomationReserve() external payable {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);
        if (msg.value == 0) revert InvalidAmount();
        uint128 newBalance = _toUint128(uint256(vault.automationReserve) + msg.value);
        vault.automationReserve = newBalance;
        emit AutomationReserveToppedUp(msg.sender, msg.value, newBalance);
    }

    function withdrawAutomationReserve(uint256 amount) external nonReentrant {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);
        if (amount == 0 || amount > vault.automationReserve) {
            revert InsufficientAutomationReserve(vault.automationReserve, amount);
        }
        vault.automationReserve -= _toUint128(amount);
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert NativeTransferFailed(msg.sender, amount);
        emit AutomationReserveWithdrawn(msg.sender, amount, vault.automationReserve);
    }

    /// @notice Permanently removes an empty vault position. The owner may create a new vault later.
    function closeVault() external {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);

        address[] storage tokens = _vaultTokens[msg.sender];
        uint256 length = tokens.length;
        for (uint256 i; i < length; ++i) {
            address token = tokens[i];
            uint256 balance = _tokenBalances[msg.sender][token];
            if (balance != 0) revert VaultHasAssets(token, balance);
            delete _knownToken[msg.sender][token];
            delete _tokenBalances[msg.sender][token];
        }

        if (vault.automationReserve != 0) revert VaultHasAutomationReserve(vault.automationReserve);
        delete _vaultTokens[msg.sender];
        delete _beneficiaries[msg.sender];
        delete _vaults[msg.sender];
        emit VaultClosed(msg.sender);
    }

    /// @notice Resets the caller's dead-man-switch clock.
    function checkIn() external {
        Vault storage vault = _vaults[msg.sender];
        if (vault.owner == address(0)) revert VaultNotFound(msg.sender);
        if (!vault.active || vault.inheritanceTriggered) revert VaultInactive(msg.sender);

        uint64 currentTimestamp = uint64(block.timestamp);
        vault.lastCheckIn = currentTimestamp;
        emit CheckedIn(msg.sender, currentTimestamp);
    }

    /// @notice Permanently triggers an eligible vault.
    function triggerInheritance(address owner) external nonReentrant {
        Vault storage vault = _requireVault(owner);
        if (vault.inheritanceTriggered) revert InheritanceAlreadyTriggered(owner);
        if (!vault.active || !_inheritanceEligible(vault)) revert InheritanceNotEligible(owner);

        vault.active = false;
        vault.inheritanceTriggered = true;
        uint64 triggeredAt = uint64(block.timestamp);
        emit InheritanceTriggered(owner, msg.sender, triggeredAt);
        _payAutomationFee(owner);
    }

    /// @notice Snapshots and attempts distribution for one token after inheritance is triggered.
    function distributeInheritanceToken(address owner, address token) external nonReentrant {
        Vault storage vault = _requireVault(owner);
        if (!vault.inheritanceTriggered) revert InheritanceNotTriggered(owner);
        if (!_knownToken[owner][token]) revert InvalidToken(token);
        if (_inheritanceTokenProcessed[owner][token]) revert InheritanceTokenAlreadyProcessed(owner, token);

        _inheritanceTokenProcessed[owner][token] = true;
        _processedTokenCount[owner] += 1;
        uint256 vaultBalance = _tokenBalances[owner][token];
        _tokenBalances[owner][token] = 0;
        emit InheritanceTokenProcessed(owner, token, vaultBalance);
        if (vaultBalance != 0) _distributeToken(owner, token, vaultBalance, vault.checkInInterval);
        _payAutomationFee(owner);
    }

    /// @notice Retries one failed distribution after the configured retry interval.
    function retryInheritanceDistribution(address owner, address token, address beneficiary) external nonReentrant {
        uint256 amount = _pendingInheritance[owner][token][beneficiary];
        if (amount == 0) revert NoPendingInheritance(owner, token, beneficiary);
        uint256 nextRetryAt = _nextDistributionRetry[owner][token][beneficiary];
        if (block.timestamp < nextRetryAt) revert RetryNotReady(nextRetryAt);
        Vault storage vault = _requireVault(owner);
        _attemptDistribution(owner, token, beneficiary, amount, vault.checkInInterval);
        _payAutomationFee(owner);
    }

    function getVault(address owner) external view returns (Vault memory) {
        Vault memory vault = _vaults[owner];
        if (vault.owner == address(0)) revert VaultNotFound(owner);
        return vault;
    }

    function getBeneficiaries(address owner) external view returns (Beneficiary[] memory) {
        if (_vaults[owner].owner == address(0)) revert VaultNotFound(owner);
        return _beneficiaries[owner];
    }

    function vaultExists(address owner) external view returns (bool) {
        return _vaults[owner].owner != address(0);
    }

    function getTokenBalance(address owner, address token) external view returns (uint256) {
        return _tokenBalances[owner][token];
    }

    function getVaultTokens(address owner) external view returns (address[] memory) {
        if (_vaults[owner].owner == address(0)) revert VaultNotFound(owner);
        return _vaultTokens[owner];
    }

    function nextExpectedCheckIn(address owner) external view returns (uint256) {
        Vault storage vault = _requireVault(owner);
        return uint256(vault.lastCheckIn) + uint256(vault.checkInInterval);
    }

    function missedCheckIns(address owner) public view returns (uint8) {
        Vault storage vault = _requireVault(owner);
        if (!vault.active || vault.inheritanceTriggered || block.timestamp <= vault.lastCheckIn) return 0;

        uint256 elapsed = block.timestamp - uint256(vault.lastCheckIn);
        uint256 missed = elapsed / uint256(vault.checkInInterval);
        if (missed > vault.maxMissedCheckIns) return vault.maxMissedCheckIns;
        return uint8(missed);
    }

    function inheritanceEligible(address owner) external view returns (bool) {
        Vault storage vault = _requireVault(owner);
        return _inheritanceEligible(vault);
    }

    function getPendingInheritance(address owner, address token, address beneficiary) external view returns (uint256) {
        return _pendingInheritance[owner][token][beneficiary];
    }

    function getNextDistributionRetry(address owner, address token, address beneficiary)
        external
        view
        returns (uint256)
    {
        return _nextDistributionRetry[owner][token][beneficiary];
    }

    function inheritanceTokenProcessed(address owner, address token) external view returns (bool) {
        return _inheritanceTokenProcessed[owner][token];
    }

    function automationReserve(address owner) external view returns (uint256) {
        return _requireVault(owner).automationReserve;
    }

    /// @dev Isolated subcall: a false/reverting token rolls back any token-side state change.
    function attemptTokenTransfer(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        uint256 beforeBalance = _erc20Balance(token);
        _safeTransfer(token, to, amount);
        uint256 afterBalance = _erc20Balance(token);
        if (beforeBalance < amount || afterBalance != beforeBalance - amount) revert TokenBalanceInvariant(token);
    }

    /// @notice Claims unused automation fees after every token is processed and every retry is paid.
    /// @dev This is a relayer incentive, not an owner withdrawal path.
    function claimCompletedAutomationReserve(address owner) external nonReentrant {
        Vault storage vault = _requireVault(owner);
        if (
            !vault.inheritanceTriggered || _processedTokenCount[owner] != _vaultTokens[owner].length
                || _pendingDistributionCount[owner] != 0
        ) {
            revert InheritanceIncomplete(owner);
        }
        uint256 amount = vault.automationReserve;
        if (amount == 0) revert InvalidAmount();
        vault.automationReserve = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert NativeTransferFailed(msg.sender, amount);
        emit AutomationFeePaid(owner, msg.sender, amount, 0);
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function _requireVault(address owner) private view returns (Vault storage vault) {
        vault = _vaults[owner];
        if (vault.owner == address(0)) revert VaultNotFound(owner);
    }

    function _payAutomationFee(address owner) private {
        Vault storage vault = _vaults[owner];
        uint256 reserve = vault.automationReserve;
        if (reserve == 0) return;
        uint256 fee = reserve < automationFeeWei ? reserve : automationFeeWei;
        if (fee == 0) return;
        vault.automationReserve = uint128(reserve - fee);
        (bool success,) = msg.sender.call{value: fee}("");
        if (!success) {
            vault.automationReserve = uint128(reserve);
            return;
        }
        emit AutomationFeePaid(owner, msg.sender, fee, reserve - fee);
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert ReserveOverflow();
        return uint128(value);
    }

    function _inheritanceEligible(Vault storage vault) private view returns (bool) {
        if (!vault.active || vault.inheritanceTriggered) return false;
        uint256 threshold =
            uint256(vault.lastCheckIn) + uint256(vault.checkInInterval) * uint256(vault.maxMissedCheckIns);
        return block.timestamp >= threshold;
    }

    function _attemptDistribution(
        address owner,
        address token,
        address beneficiary,
        uint256 amount,
        uint64 retryInterval
    ) private {
        if (_tryTransfer(token, beneficiary, amount)) {
            delete _pendingInheritance[owner][token][beneficiary];
            delete _nextDistributionRetry[owner][token][beneficiary];
            _pendingDistributionCount[owner] -= 1;
            emit InheritanceDistributed(owner, token, beneficiary, amount);
        } else {
            uint256 nextRetryAt = block.timestamp + uint256(retryInterval);
            _nextDistributionRetry[owner][token][beneficiary] = nextRetryAt;
            emit InheritanceDistributionFailed(owner, token, beneficiary, amount, nextRetryAt);
        }
    }

    function _distributeToken(address owner, address token, uint256 vaultBalance, uint64 retryInterval) private {
        Beneficiary[] storage recipients = _beneficiaries[owner];
        uint256 beneficiaryCount = recipients.length;
        uint256 distributedAllocation;
        for (uint256 beneficiaryIndex; beneficiaryIndex < beneficiaryCount; ++beneficiaryIndex) {
            Beneficiary storage recipient = recipients[beneficiaryIndex];
            uint256 amount;
            if (beneficiaryIndex + 1 == beneficiaryCount) {
                amount = vaultBalance - distributedAllocation;
            } else {
                amount = vaultBalance * recipient.allocationBps / TOTAL_ALLOCATION_BPS;
                distributedAllocation += amount;
            }
            if (amount == 0) continue;
            _pendingInheritance[owner][token][recipient.account] = amount;
            _pendingDistributionCount[owner] += 1;
            _attemptDistribution(owner, token, recipient.account, amount, retryInterval);
        }
    }

    function _tryTransfer(address token, address to, uint256 amount) private returns (bool) {
        (bool success,) = address(this).call{gas: TOKEN_TRANSFER_GAS_LIMIT}(
            abi.encodeCall(this.attemptTokenTransfer, (token, to, amount))
        );
        return success;
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

    function _validateSettings(uint64 checkInInterval, uint8 maxMissedCheckIns) private pure {
        if (checkInInterval == 0 || checkInInterval > MAX_CHECK_IN_INTERVAL) {
            revert InvalidCheckInInterval(checkInInterval);
        }
        if (maxMissedCheckIns == 0 || maxMissedCheckIns > MAX_MISSED_CHECK_INS) {
            revert InvalidMaxMissedCheckIns(maxMissedCheckIns);
        }
    }

    function _replaceBeneficiaries(address owner, address[] calldata accounts, uint16[] calldata allocationsBps)
        private
    {
        uint256 length = accounts.length;
        if (length == 0) revert BeneficiariesRequired();
        if (length > MAX_BENEFICIARIES) revert TooManyBeneficiaries(length, MAX_BENEFICIARIES);
        if (length != allocationsBps.length) {
            revert BeneficiaryArrayLengthMismatch();
        }

        uint256 totalAllocation;
        for (uint256 i; i < length; ++i) {
            address account = accounts[i];
            uint16 allocation = allocationsBps[i];
            if (account == address(0)) {
                revert InvalidBeneficiary(account);
            }
            if (allocation == 0) revert InvalidAllocation(allocation);

            for (uint256 j; j < i; ++j) {
                if (accounts[j] == account) {
                    revert DuplicateBeneficiary(account);
                }
            }
            totalAllocation += allocation;
        }

        if (totalAllocation != TOTAL_ALLOCATION_BPS) {
            revert InvalidTotalAllocation(totalAllocation);
        }

        delete _beneficiaries[owner];
        for (uint256 i; i < length; ++i) {
            _beneficiaries[owner].push(Beneficiary({account: accounts[i], allocationBps: allocationsBps[i]}));
        }

        emit BeneficiariesUpdated(owner, accounts, allocationsBps);
    }
}
