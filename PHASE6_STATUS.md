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

## Milestone 6.3 (COMPLETE): Managed relayer signer (ARCHITECTURE.md §14)

Removes the direct raw private-key ingestion that used to live in `runOnce.ts`
(`new Wallet(privateKey, provider)` bound straight into the submitter). Key
management is now behind a clean seam.

### `backend/src/automation/`
- `RelayerSigner.ts` — the signing boundary:
  - `RelayerSigner` — an address + `send`/`wait`. No path exposes, logs, or
    stores key material.
  - `EthersRelayerSigner` — wraps an ethers signer (legacy testnet) without
    leaking its key on the surface; guards the chain ID before submitting.
  - `RemoteSigningServiceSigner` — production path: the backend transmits the
    **unsigned** payload (to/data/value/chainId) over an authenticated channel
    to an external signing service that never shares its key; the service
    signs, broadcasts, and returns the hash/receipt.
- `ManagedRelayerSubmitter` — the single submission path for `AutomationWorker`:
  delegates to the injected `RelayerSignerProvider`.
- `createRelayerSignerProvider()` — env-driven selection:
  - `KINN_RELAYER_SIGNER_URL` (+ optional `KINN_RELAYER_SIGNER_TOKEN`,
    `KINN_RELAYER_ADDRESS`) → `remote_signing_service` (no key in-process).
  - else `KINN_RELAYER_PRIVATE_KEY` → `legacy_env_key` fallback (in-memory
    ethers wallet, key unreachable from the submission surface). Not a
    production path.
  - neither → throws a clear configuration error.

### Removed / migrated
`runOnce.ts` no longer reads or constructs any wallet: it builds the provider
from the env and logs only public relayer addresses (plus the signing mode).
`EthersRelayerSubmitter.ts` (which held the raw-key signer map) is deleted.

### Tests
`RelayerSigner.test.ts`: payload forwarding + chain-ID guard on the ethers
signer; no key material reachable on its surface; remote-service request shape
(url, body, bearer auth) + result parsing; HTTP-failure and incomplete-receipt
handling; submitter delegation; factory mode selection and missing-config error.
- `tsc` → OK · `npm run build:backend` → OK · `npm run test:backend` → **78/78**.

## Milestone 6.4 (COMPLETE): Web-App REST API transport (API.md)

The backend now serves the documented REST API for the Web App, on top of the
factory+instance contract layer (6.1), the durable DB (6.2), and the managed
signer (6.3).

### `backend/src/web/`
- `KinnHttpApi.ts` — stateless request→response router mounted at
  `/api/v1/:networkKey/...`:
  - **Auth**: `POST /auth/challenge` (EIP-712, binds wallet+user+nonce+chain),
    `/auth/verify` → bearer session, `/auth/session`, `/auth/logout`.
  - **Wallet** (session-gated): `GET /wallet`, `/wallet/address`,
    `/wallet/balances` (live ETH + USDC via `eth_call`/`eth_getBalance`),
    `/wallet/transactions` (empty until Phase 8 indexing), `POST /wallet/send`.
  - **Assets**: `GET /assets` — ETH + native USDC only; unsupported tokens are
    never claimed.
  - **Vault**: `POST /vaults` (create via factory), `GET /vaults/:owner/status`,
    `/activity`, `/beneficiaries`, `/inheritance*`, and owner-scoped writes
    (`close`, `inheritance/checkin`, `PUT|DELETE beneficiaries`).
  - **Transactions**: `POST /transactions/prepare` (unsigned), `/simulate`
    (`eth_call`; explicitly not confirmation), `/submit` returns 202
    `unbroadcast` — the wallet/KeyManager signs and broadcasts; the API never
    submits funds.
  - BigInts serialize as decimal strings; errors use the API.md model
    (`4xx` with a stable code, `5xx` structured `{ error }`). The wallet
    namespace authenticates before revealing route existence.
- `supportedAssets.ts` — per-network supported-asset resolution
  (`KINN_<NET>_USDC`, values from `BASE_INTEGRATION.md`), plus `rawBalanceOf`.
- `ApiServer.ts` + `launch.ts` — deployable Node HTTP server (`npm run api:serve`,
  port `KINN_API_PORT`).

### Boundaries preserved
- Every write returns an **unsigned** `PreparedTransaction`; the first-party
  KeyManager (Phase 5) is the only signer and broadcaster.
- Owner writes bind `owner` to the verified session wallet (via
  `AuthenticatedKinnApi`) — a caller can never prepare a write for another owner.
- Indexed history/activity remain empty until Phase 8; the API returns `[]`
  rather than inventing data.

### Tests
`KinnHttpApi.test.ts` (8): assets set, challenge+verify → session → wallet,
missing-token 401, live balances (ETH 1.5 / USDC 7.77 via mocks), factory-
resolved vault status, session-bound owner write (`from` = session wallet,
`to` = resolved instance), unsigned prepare, and 404/401 structure.
- `tsc` → OK · `npm run build:backend` → OK · `npm run test:backend` → **86/86**.

## Phase 6 status: COMPLETE

All three documented Phase 6 deliverables are done and tested:
1. Backend re-pointed to Factory + instance (6.1)
2. Durable DB layer with the §9 source-of-truth boundary (6.2)
3. Managed relayer signer — no raw key ingestion (6.3)
4. Web-App REST API transport implementing `API.md` (6.4)

Next: Phase 7 (Base deployment) per `ARCHITECTURE.md` §17.

## Security note
`.env` still contains historical private keys, a Telegram bot token, and an
OpenAI key from pre-Phase-3 testnet work. Treat these as compromised and rotate
them (per `PROJECT_HANDOFF.md`).