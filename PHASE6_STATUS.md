# Kinn — Phase 6 Status Note

Status: BUILD-IN-PROGRESS · 2026-08-29

Phase 6 is the **Backend / DB / API** phase: re-pointing the service layer to the
Factory + per-owner instance model, durable storage, a managed relayer signer,
and the Web-App REST API from `API.md`. This note tracks the first completed
milestone.

## Milestone 6.1 (COMPLETE): Backend contract layer re-pointed to Factory + instance

The backend previously talked to the **old single-contract model**
(`KinnContractService.getVault(owner)`, a single `contractAddress` that owned
everything). Phases 3–4 rebuilt the contracts into a **VaultFactory + KinnVault
instance** model (`src/VaultFactory.sol`, `src/KinnVault.sol`), and Phase 6 now
re-points the backend to it:

### New ABI modules (`backend/src/contracts/`)
- `factoryAbi.ts` — `VaultFactory` views (`vaultOf`, `vaultCount`, `vaultAt`,
  `isVault`, `automationFeeWei`) + `createVault` + `VaultCreated` event.
- `vaultAbi.ts` — the self-contained `KinnVault` instance: owner/factory/state
  views, `protectedAssetBalance`, `getBeneficiaries`, `getTrackedAssets`,
  `pendingInheritance`, `nextDistributionRetry`, `inheritanceAssetProcessed`,
  all owner actions, all permissionless keeper/manager actions, and the full
  instance event set. Also exports `ETH_SENTINEL` and the `InheritanceState`
  enum -> stable name map (`Active/Missed/Eligible/Distributing/Distributed/Closed`).

### Rewritten `KinnContractService` (factory + instance aware)
- **Discovery**: `discoverVault(owner)` resolves the owner's instance through
  the factory `vaultOf` registry; `isVault`, `getFactoryAutomationFee`.
- **Reads** run against the resolved instance (`getVaultStatus`, `getVault`,
  `getState`, `getBeneficiaries`, `getTrackedAssets`, `getAssetBalance`,
  `getTokenBalances`, `getInheritanceEligible`, `getEligibilityDeadline`,
  `isInheritanceAssetProcessed`, `getPendingInheritance`,
  `getNextDistributionRetry`, and ETH/ERC-20 `getAssetDisplay`).
- **Prepares** are owner-scoped and async: the target vault is resolved via
  `vaultOf` first. `prepareCreateVault` targets the **factory**; every other
  write targets the owner's **instance**. Keeper/manager actions
  (`triggerInheritance`, `distributeInheritanceAsset`,
  `retryInheritanceDistribution`, `claimAutomationReserve`) drop the old
  `owner` parameter (the contract now derives it from its own storage).
- `VaultView` gained an optional `address` (the instance address).

### Callers re-pointed
- `KinnAutomationGateway` now calls the instance-based methods and awaits async
  prepares; `AutomationGateway.prepare*` return `Promise<PreparedTransaction>`
  (worker `await`s them).
- `KinnApi.prepareTransaction` is async and owner-scoped; prepared writes target
  the correct contract. Owner actions require an `owner` and bind it to the
  wallet (only the KeyManager signs).
- `AuthenticatedKinnApi` gains an `OwnerPrepareAction` (no `owner` supplied by
  the caller) and injects the **session wallet** as `owner` — the caller can
  never spoof another owner. Made async; the Telegram gateway/bot `await` it.

### Boundaries preserved
- The backend still **never signs or submits**. It only reads chain state and
  prepares **unsigned** `PreparedTransaction`s. The wallet (first-party
  `KeyManager`, Phase 5) is the only signer.
- The old single-contract `kinnAbi.ts` is retained for `KinnEventMonitor`
  (indexing is Phase 8); no Telegram behaviour changed beyond awaiting the
  async prepare call.

## Tests

`backend/test/KinnContractService.test.ts` was rewritten for the instance model
(12 tests): factory discovery (`vaultOf` resolves instance / `null` when absent),
`getVaultStatus` aggregation, `state` name mapping, no-vault error, factory-
targeting `createVault`, instance-targeting owner actions, keeper actions
(owner arg dropped), reserve value-carrying tx, approval spender = resolved
instance, ETH vs ERC-20 display, amount parsing, and closed-vault `active`.

- `tsc -p backend/tsconfig.json` → **OK**.
- `npm run build:backend` → **OK**.
- `npm run test:backend` → **60/60 pass** (was 55 baseline; +5 from the
  rewritten contract-layer suite).
- `npm run test:contracts` → unchanged (contracts untouched this milestone).

## Milestone 6.2 (COMPLETE): Durable DB layer (ARCHITECTURE.md §9)

Replaces the ad-hoc persistence (append-only JSONL + hand-rolled JSON file +
in-memory cursor) with a coherent durable store that encodes the §9
source-of-truth boundary in the data layer itself.

### New `backend/src/db/`
- `DocumentStore.ts` — `JsonFileDocumentStore`:
  - **Atomic writes** (temp file + rename, mode 0600) so a crash never leaves a
    half-written document.
  - **Per-collection write serialization** with an `update()` read-modify-write
    primitive, so concurrent workers (automation + reminders) can share the
    directory without losing updates.
  - **Corruption recovery**: an unparseable file is quarantined
    (`*.corrupt-<ts>`) and the collection starts from its fallback — stored
    data is derived/rebuildable, so the service never crashes on it.
  - **BigInt-safe JSON** round-tripping.
  - **`source` flag per collection** (`app_data` vs `chain_mirror`) enforced at
    registration and surfaced via `manifest()` — the DB never claims authority
    over chain state.
- `DurableAutomationRecordRepository` — bounded (5,000) run history replacing
  `data/automation.jsonl`, with `recent()` for ops surfaces.
- `DurableEventCursorRepository` — restart-safe indexing cursor, one per
  network key, replacing the in-memory cursor for real runs.
- `DurableReminderRepository` — subscriptions + delivery dedupe, replacing
  `FileReminderRepository`.
- `createDocumentStore()` — shared store from `KINN_DB_DIR` (default
  `data/db`). The old `KINN_REMINDER_STORE`/`KINN_AUTOMATION_RECORDS` file
  paths are retired.

### Migrated
`reminders/worker.ts`, `telegram/poll.ts`, and `automation/runOnce.ts` now run
on the durable store; the old `FileReminderRepository` and
`FileAutomationRecordRepository` are deleted.

### Tests
New suites: `DocumentStore.test.ts` (restart persistence, fallback on missing
collections, BigInt round-trip, corruption quarantine, concurrent
read-modify-write consistency, manifest/source flags, path-escape rejection)
and `DurableRepositories.test.ts` (record durability/bounding, per-network
cursor durability, reminder durability).
- `tsc` → OK · `npm run build:backend` → OK · `npm run test:backend` → **71/71**.

## Next (Phase 6 continuing)
- Durable repository/DB layer replacing the in-memory/JSONL repos (§9).
- Managed relayer signer fix (raw private-key ingestion in `runOnce.ts`), §14.
- Web-App REST API transport implementing `API.md` (auth + wallet + vault +
  transactions + automation endpoints).

## Security note
`.env` still contains historical private keys, a Telegram bot token, and an
OpenAI key from pre-Phase-3 testnet work. Treat these as compromised and rotate
them (per `PROJECT_HANDOFF.md`).