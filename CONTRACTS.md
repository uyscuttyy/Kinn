# Kinn — Smart Contract Architecture (Phase 2)

Status: COMPLETE · 2026-08-28. This is the contract design that Phase 3 will build. It preserves the audited inheritance logic and adds the Factory/instance model, the explicit state machine, and native-ETH support.

## 1. File layout (Phase 3 target)

```
src/
  VaultFactory.sol      # deployment + registry + CREATE2 instances
  KinnVault.sol         # per-owner vault instance (inheritance logic preserved)
  VaultTypes.sol        # shared structs + InheritanceState enum + errors/events
  interfaces/IKinnVault.sol
  interfaces/IVaultFactory.sol
```

Solidity target: 0.8.24 (matches existing toolchain; optimizer runs 200). No unchecked blocks on fund math.

## 2. `KinnVault` (instance)

Each deployed instance holds its own authoritative state. No global `mapping(owner => Vault)`.

```solidity
enum InheritanceState { Active, Missed, Eligible, Distributing, Distributed }

struct Vault {
    address owner;                 // the Kinn wallet that created the vault (immutable after init)
    InheritanceState state;        // explicit state machine
    bool inheritanceTriggered;     // mirror of state == Distributing/Distributed
    uint64 lastCheckIn;
    uint64 checkInInterval;        // seconds, validated
    uint8  maxMissedCheckIns;      // 1..MAX
    uint128 automationReserve;     // native ETH reserve (separate from ETH protected assets)
}

struct Beneficiary { address account; uint16 allocationBps; }
struct Asset { address token; uint128 balance; }   // accounting; ETH represented by a sentinel token
```

Constants (retained): `MAX_CHECK_IN_INTERVAL`, `MAX_MISSED_CHECK_INS`, `TOTAL_ALLOCATION_BPS = 10_000`, `MAX_BENEFICIARIES = 50`, `TOKEN_TRANSFER_GAS_LIMIT = 200_000`, immutable `automationFeeWei`.

### ETH-as-asset representation
- Native ETH is modeled with a **sentinel address** `ETH_SENTINEL = address(0x1111...1)` in the asset/event layer so backend logic can treat all assets uniformly. The contract tracks protected ETH via `address(this).balance - automationReserve` (never `balanceOf`).
- `depositETH(uint256 amount)` (payable; `msg.value` credited, revert on mismatch), `withdrawETH(uint256 amount)`, and ETH inheritance distribution via `transfer`/`call` guarded and reentrancy-safe; rejected ETH stays pending for retry just like tokens.
## 3. `VaultFactory`

- Constructor: takes the implementation address (or deploys it), the maintenance `automationFeeWei`.
- `createVault(owner, checkInInterval, maxMissedCheckIns, accounts, allocationsBps) external returns (address vault)`:
  - `msg.sender == owner` (an EOA wallet; a later smart-account path eases to any authorizer).
  - Reverts if `vaultOf(owner) != 0` (one-vault-per-user) — **idempotency via revert**, no duplicate vaults.
  - Deploys a `KinnVault` **clone** via EIP-1167 with CREATE2 `salt = keccak256(abi.encode(owner, nonce++))`.
  - Calls the instance's `initialize(...)` which sets `owner = msg.sender` (the wallet) — only the factory may call `initialize`/`onlyFactory`.
  - Records `owner -> vault`, emits `VaultCreated(owner, vault, salt)`.
- Discovery: `vaultOf(owner)`, `vaultCount()`, `vaultAddresses(offset, limit)`, `vaultExists(instance)`.
- `isVault(addr)` returns whether an address was deployed by this factory (veto foreign instances).

Rationale for clones: minimal proxies (EIP-1167) keep per-vault deployment cheap, each instance has its own storage, and the audited inheritance logic lives in the shared implementation. Downside (an upgrade affects all instances) is explicit and documented; a full-deploy model is also supported by the same interface.

## 4. Access control model

| Function | Caller allowed | Notes |
|---|---|---|
| `initialize` | factory only | sets owner exactly once |
| `updateSettings` | owner | only while Active/Missed |
| `updateBeneficiaries` | owner | only while Active/Missed |
| `depositETH` / `depositERC20` / `withdrawETH` / `withdrawERC20` | owner | only while Active/Missed |
| `checkIn` | owner | resets timer; Active/Missed/Eligible -> Active |
| `closeVault` | owner | only when all balances + reserve are zero |
| `triggerInheritance` | anyone | independent on-chain eligibility check |
| `distributeInheritanceToken` | anyone | per-token once |
| `retryInheritanceDistribution` | anyone | stored pending only |
| `claimAutomationReserve` | anyone | only when fully complete |
| `topUpAutomationReserve` / `withdrawAutomationReserve` | owner | only while Active/Missed |

Non-owner attempts to configure/deposit/withdraw/check-in/close revert. The factory cannot act on behalf of an owner beyond deploying the instance.

## 5. Eligibility + state transitions (on-chain truth)

- `state()` view derives `Active`/`Missed`/`Eligible` from `lastCheckIn`, `checkInInterval`, `maxMissedCheckIns`, `block.timestamp`.
- `eligibilityDeadline()` view returns `lastCheckIn + checkInInterval * maxMissedCheckIns` (the moment eligibility holds).
- `missedCheckIns()` = `floor((block.timestamp - lastCheckIn) / interval)` capped at max.
- Every transition is guarded (early/duplicate/unauthorized revert). `Active/Missed/Eligible` are derived so the timer stays authoritative; `Distributing/Distributed` are stored once `triggered`.

## 6. Distribution (per-token / ETH)

- `triggerInheritance`: require `state == Eligible` -> set `state = Distributing`, `inheritanceTriggered = true`, emit `InheritanceTriggered`, pay automation fee.
- `distributeInheritanceToken(asset)`: require triggered; snapshot balance once; zero accounting; split per allocation BPs (remainder -> last); isolated transfer; retain pending for failures; emit events.
- Reentrancy guard on all external calls that move funds; isolated self-call for token/ETH delivery with exact balance invariant and gas cap.
- Double-distribution prevented via one-time snapshot + successful-entitlement clearing.

## 7. Events (indexer contract)

`VaultCreated(owner, vault, salt)`, `VaultInitialized(owner, vault)`, `AssetDeposited/Withdrawn(owner, token, amount)` (token may be ETH sentinel), `BeneficiariesUpdated(owner, accounts, allocationsBps)`, `CheckedIn(owner, timestamp)`, `InheritanceTriggered(owner, executor, timestamp)`, `InheritanceTokenProcessed(owner, token, amount)`, `InheritanceDistributed(owner, token, beneficiary, amount)`, `InheritanceDistributionFailed(owner, token, beneficiary, amount, nextRetryAt)`, `RetryScheduled`, `AutomationReserveToppedUp/Withdrawn/Paid`, `VaultClosed(owner)`.

## 8. Gas / limits / invariants

- Beneficiary cap 50 bounds per-token iteration; distribution is one-token-per-tx.
- Isolated delivery gas cap 200k; balance-invariant check on success.
- Invariants to hold (locked as tests in Phase 4): sum allocations == 10000 BPs; distributed <= vault balance; no double distribution; non-owner cannot alter protected config; reserve never conflated with protected ETH; no partial state on failed distribution.
- ETH sentinel prevents `balanceOf` calls; all ETH math bounded by available balance minus reserve.

## 9. Testing scope (lock into Phase 4)

Vault creation/ownership, deposits/withdrawals (ETH + USDC), beneficiary add/update/remove, allocation validation (including sum != 10000, zero/duplicate/too-many), check-ins, missed thresholds, eligibility boundaries (exact/first-missed/eligible/early), distribution (multi-beneficiary, multi-asset, zero-balance, rounding, failed-retry), unauthorized calls, reentrancy, double distribution, invalid state transitions, factory idempotency/duplicate suppression, discovery. Invariant/fuzz: allocation sum; distributed <= balance; no double execution; owner-only configuration; ETH/token balance conservation.
- The automation reserve and protected ETH are **two separate balances**; top-up/withdraw/claim touch only the reserve.