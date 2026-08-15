# Kinn — Phase 0 Technical Design

## 1. Scope and design goals

Kinn is a non-custodial inheritance vault. The smart contract is the source of truth; the backend, Telegram bot, and AI may read state and prepare actions, but cannot authorize or move user assets. Every state-changing owner action is signed by the owner wallet. Inheritance execution may be submitted by an automation account or any caller, but the contract independently verifies eligibility before distributing funds.

The initial design uses one `KinnVault` contract with one vault per owner address. Kinn is RWA-first at the base ERC-20 compatibility level: the primary assets are tokenized real-world assets exposed through ERC-20-compatible contracts, while ordinary crypto ERC-20s are a secondary use case. Kinn does not attempt to implement issuer identity/compliance rules in its first version.

## 2. Smart-contract design

### Vault state

```solidity
struct Vault {
    address owner;
    uint64 lastCheckIn;
    uint64 checkInInterval;       // seconds; bounded by 9 weeks
    uint8 maxMissedCheckIns;      // bounded by 5
    bool active;
    bool inheritanceExecuted;
}

struct Beneficiary {
    address account;
    uint16 percentageBps;         // basis points; 10_000 = 100%
}
```

Core storage:

- `mapping(address => Vault) vaults` — owner to vault; an absent vault has `owner == address(0)`.
- `mapping(address => Beneficiary[]) beneficiaries` — ordered beneficiary list per owner.
- `mapping(address => mapping(address => uint256)) tokenBalances` — accounting balance per owner and ERC-20 token (or, alternatively, contract-held balances can be queried directly; an explicit balance mapping is preferred only if accounting is needed).
- `mapping(address => address[]) vaultTokens` plus a membership mapping — tokens deposited into each vault, so inheritance can iterate only assets that actually exist.
- `mapping(address => mapping(address => mapping(address => uint256))) pendingInheritance` — owner, token, and beneficiary to the amount that remains payable after inheritance has triggered.
- Token membership/indexing storage used to enumerate assets held for a vault. Base-level support accepts ERC-20-compatible token addresses rather than enforcing beneficiary pre-approval.

One vault per owner is the Phase 0/1 assumption. A later version can replace the owner key with a vault ID without changing the surrounding services.

### Events

- `VaultCreated(owner, checkInInterval, maxMissedCheckIns)`
- `VaultSettingsUpdated(owner, checkInInterval, maxMissedCheckIns)`
- `BeneficiariesUpdated(owner, beneficiaries, percentagesBps)`
- `CheckedIn(owner, timestamp)`
- `AssetDeposited(owner, token, amount)`
- `AssetWithdrawn(owner, token, amount)`
- `InheritanceTriggered(owner, executor, timestamp)`
- `InheritanceDistribution(owner, token, beneficiary, amount)`
- `InheritanceDistributionFailed(owner, token, beneficiary, amount)`
- `InheritanceDistributionRetried(owner, token, beneficiary, amount)`

Events are for indexing, notifications, and auditability; consumers must re-read contract state after events.

### Public/external API

Owner-authorized functions:

- `createVault(intervalSeconds, maxMissedCheckIns, initialBeneficiaries)`
- `updateSettings(intervalSeconds, maxMissedCheckIns)`
- `updateBeneficiaries(accounts, percentagesBps)`
- `checkIn()`
- `deposit(token, amount)`
- `withdraw(token, amount)`

Read functions:

- `getVault(owner)`
- `getBeneficiaries(owner)`
- `getTokenBalance(owner, token)`
- `getVaultTokens(owner)`
- `nextCheckIn(owner)`
- `missedCheckIns(owner)`
- `inheritanceEligible(owner)`
- `getPendingInheritance(owner, token, beneficiary)`
- `retryInheritanceDistribution(owner, token, beneficiary)`

Permission rules:

- Only `msg.sender == vault.owner` can create/update settings, update beneficiaries, deposit to their own vault, withdraw, or check in.
- `triggerInheritance(owner)` is permissionless in the sense that anyone/automation may submit it, but all eligibility and state checks are performed on-chain.
- No backend/admin withdrawal key exists. Any emergency/admin function, if later required, must be explicitly specified and must not bypass owner authorization.

### Validation rules

- `intervalSeconds > 0` and `intervalSeconds <= 9 weeks`.
- `1 <= maxMissedCheckIns <= 5`.
- Beneficiary list is non-empty, addresses are non-zero and unique, each percentage is greater than zero, and total percentage is exactly `10_000` basis points.
- A vault cannot be created twice for the same owner.
- Settings/beneficiaries cannot be changed after inheritance has triggered.
- `createVault` records `lastCheckIn = block.timestamp`.

### Check-in and inheritance timing

The canonical rule is: a check-in is due every `checkInInterval`; missed count is the number of complete intervals elapsed since `lastCheckIn`, capped at `maxMissedCheckIns`. Inheritance becomes eligible when:

`block.timestamp >= lastCheckIn + (checkInInterval * maxMissedCheckIns)`.

This makes the threshold unambiguous and avoids backend-dependent calculations. `checkIn()` is allowed at any time while active (including early check-ins) and resets `lastCheckIn` to the current timestamp. At exact boundary timestamps, eligibility is true. The contract uses checked arithmetic; configuration bounds make multiplication safe.

### Assets and inheritance

RWA-compatible ERC-20 assets are the primary scope; ordinary crypto ERC-20s use the same path. Deposits use safe low-level ERC-20 handling compatible with tokens that return `true` and tokens that return no value. Zero amounts are rejected. The contract tracks deposited token addresses per vault. Kinn does not claim custody of off-chain title: the issuer and legal wrapper remain responsible for the underlying RWA.

Inheritance triggering and inheritance delivery are deliberately separate. Once the timing threshold is reached, `triggerInheritance(owner)` permanently marks the vault inactive and inheritance-triggered before attempting any external token transfers. The owner can no longer check in, change settings/beneficiaries, deposit, or withdraw through that vault.

At trigger time, the contract snapshots each beneficiary's entitlement for every held token. For each beneficiary except the last, entitlement is `snapshotBalance * percentageBps / 10_000`; the last beneficiary receives the remainder. Each entitlement is stored as pending before transfers are attempted. A successful transfer clears that pending amount. A failed transfer leaves it pending inside Kinn and emits a failure event without reverting successful distributions to other beneficiaries.

Anyone may later call the retry function for a pending distribution. A retry can only pay the stored unpaid amount, and the pending amount is cleared before the external transfer attempt and restored if the attempt fails. This prevents double payment while permitting indefinite future retries. Inheritance remains triggered regardless of transfer success; failed delivery never restores owner control or resets the dead-man switch.

## 3. Backend foundation (future Phase 6)

Services:

- **API:** authenticated read endpoints, transaction-intent preparation, and webhook/event ingestion. It never signs owner transactions or exposes withdrawal authority.
- **Blockchain service:** read-only RPC client plus typed contract bindings; prepares calldata and estimates gas; monitors confirmations and reorgs.
- **Database:** Telegram-to-wallet association, cached vault snapshots, beneficiary labels, transaction intents/status, notification preferences, and event cursors. Cached data is disposable and never authoritative.
- **Authentication:** nonce-based wallet signature challenge; short-lived sessions tied to a verified wallet and Telegram identity.
- **Notification service:** Telegram reminders and transaction status messages.
- **Automation service:** scans cached candidates, re-checks live contract eligibility, and submits `executeInheritance`; retries are idempotent because the contract rejects repeats.

### Relayer funding model

Automation gas is funded separately from inherited RWA/ERC-20 assets. At vault creation, the user may provide a native-chain-token automation reserve (ETH on Base). The relayer wallet uses this reserve to pay for inheritance-trigger and retry transactions. The reserve is metered against actual automation work and can be topped up later. Low or empty reserve state produces warnings and affects relayer-funded execution only; it never unlocks owner controls, changes entitlements, or permits withdrawal of vault assets. Anyone may still submit a valid trigger/retry transaction as a fallback, subject to the same contract checks. Future creator/service fees are intentionally separate from this reserve.

## 4. Telegram AI interface (future Phases 8–10)

Commands: `/start`, `/vault`, `/status`, `/beneficiaries`, `/settings`, `/checkin`, `/deposit`, `/withdraw`, `/help`.

Natural language intents map to a strict schema such as `create_vault`, `update_beneficiaries`, `update_settings`, `check_in`, `deposit`, `withdraw`, and read intents. The AI only extracts/normalizes parameters. Backend validation applies address, percentage, amount, and bounds checks; the contract is the final validator.

Read intents can return cached/live data. Every write intent produces a human-readable summary and a wallet-signing request/deep link. A Telegram message alone never authorizes a blockchain write.

## 5. Wallet and signature flow (future Phase 7)

1. User starts a nonce challenge from Telegram/web wallet connector.
2. Wallet signs a domain-separated message containing wallet, Telegram-session binding, nonce, chain ID, contract address, and expiry.
3. Backend verifies the signature and stores only the association and consumed nonce (never a private key).
4. For writes, backend prepares transaction calldata; the wallet signs and broadcasts it. Backend observes the transaction and confirms it from chain data.

## 6. Security model and threats

- **Unauthorized withdrawal/configuration:** enforce owner checks on every owner function; no backend signer can call them for a user.
- **False/early inheritance:** `triggerInheritance` verifies existence, active state, not-triggered state, and exact timing on-chain.
- **Double triggering/double payment:** set inheritance-triggered and `active = false` before token calls; snapshot each entitlement once; track and retry only unpaid entitlements.
- **Invalid allocations/settings:** strict validation and exact 10,000 bps total; bounds of 9 weeks and 5 missed check-ins.
- **Reentrancy:** use checks-effects-interactions and `ReentrancyGuard` around token-moving functions.
- **RWA/token edge cases:** base support targets ERC-20-compatible tokens. Transfer failure leaves the entitlement pending for later retry. Fee-on-transfer and rebasing tokens should be rejected or documented as unsupported initially because balance-based inheritance accounting may not match requested transfer amounts.
- **Rounding:** last-beneficiary remainder assignment ensures full balance distribution.
- **Backend compromise:** backend has read/prepare/automation capabilities only; cannot impersonate owners or withdraw funds. Signature nonces, expiry, chain ID, and contract address prevent replay across contexts.
- **Denial of service / many beneficiaries:** cap beneficiary count to a documented maximum before deployment, and test gas behavior. A failed transfer reverts atomically rather than partially distributing.
- **Timestamp manipulation:** use timestamps only for coarse multi-week deadlines; boundary behavior is explicitly tested.

## 7. Phase boundaries

Phase 1 implements only vault creation, settings, and beneficiaries plus unit tests. Asset accounting, check-ins, inheritance, backend, Telegram, AI, and automation are intentionally deferred to their specified phases.

## 8. Decisions to confirm before implementation

- Target EVM chain/testnet and Solidity toolchain (the default recommendation is Foundry with Solidity 0.8.24).
- Maximum beneficiary count, to be enforced for predictable gas usage (a provisional design limit of 50 is reasonable but is not yet a product requirement).
- Whether token deposits should be open to every ERC-20 address or use a simple supported-token list to exclude known incompatible fee-on-transfer/rebasing tokens.
- Who should be allowed to invoke retries (recommended: anyone, because the stored entitlement fixes the recipient and amount).
- Whether “early” check-ins should always reset the full interval (the design above says yes).
