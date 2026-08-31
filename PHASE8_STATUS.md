# Kinn — Phase 8 Status Note

Status: COMPLETE · 2026-08-31

Phase 8 delivered the event indexer (ARCHITECTURE §10): a durable-cursor,
restart-safe index of factory and vault-instance events, now powering the
API's activity and transaction history endpoints.

## What was built

### `backend/src/db/DurableVaultEventRepository.ts` (§9 `vault_events`)
- Parsed-event store registered as **`chain_mirror`** (rebuildable from the
  chain; never authoritative).
- **Deduped by `(txHash, logIndex)`** at insert time — cursor drift or re-scans
  can never double-insert.
- Queries: `byOwner(owner, limit, cursorKey)`, `byVault(address, …)`,
  `recent(limit)`, `count()` — newest-first with key-based pagination.
- Bounded (50k events, oldest trimmed); BigInt-safe decimal strings throughout.

### `backend/src/indexing/KinnEventIndexer.ts`
- Polls block ranges from the **durable cursor** (`DurableEventCursorRepository`,
  one per network), starting from the factory **deploy block** on a fresh
  cursor (`KINN_<NET>_START_BLOCK`).
- Indexes **factory logs** (`VaultCreated`) plus every registered vault's logs —
  vault discovery comes from the on-chain registry via the new
  `KinnContractService.listVaults()` (`vaultCount()`/`vaultAt(i)`).
- **Confirmation depth** (`KINN_INDEX_CONFIRMATIONS`, default 2): the unconfirmed
  head is never indexed.
- **Never advances the cursor on partial failure**: all addresses' logs are
  fetched first; any RPC error aborts the pass before persisting, so the next
  pass re-scans the same range (RPC retries handled at the worker).
- Decodes with the factory/vault ABIs; unknown topics are skipped, not fatal.
- Bounded scans per pass (`maxBatchBlocks`, default 5,000).

### Worker + API wiring
- `backend/src/indexing/worker.ts` (`npm run indexer:run`) — single pass
  (`KINN_INDEXER_ONCE=true`) or continuous loop
  (`KINN_INDEXER_INTERVAL_MS`, default 15 s) across all configured networks.
- `KinnHttpApi` now serves indexed data when an event repository is injected
  (the `ApiServer` wires it): `GET /vaults/:owner/activity` returns owner events,
  `GET /wallet/transactions` returns owner events filtered to
  state-changing/asset events. Without the store both remain `[]` — never invented.
- `KinnContractService.listVaults()` added.

## Verification

`KinnEventIndexer.test.ts` (7 tests): factory+vault indexing with idempotent
re-runs via dedupe; confirmation depth (safe head = latest − depth); partial
`getLogs` failure aborts the pass and leaves the cursor untouched (retry then
succeeds); batch caps with per-batch cursor advancement; BigInt-safe value
parsing with indexed-owner extraction; pagination newest-first across a store
restart; unknown-topic tolerance.

- `tsc` → OK · `npm run build:backend` → OK · `npm run test:backend` → **93/93**.

## Live validation (Base Sepolia)

`KINN_INDEXER_ONCE=true npm run indexer:run` against the Phase 7 factory:

```
Indexed base-sepolia: scanned=0 new=0 vaults=0 through block 46211066
```

Scanned from the deploy block (46,206,067) to the safe head (latest − 2), found
no events (correct — no vaults exist yet), and persisted the cursor. The full
§10 pipeline is live against the real chain and will populate as vaults are
created.

## Next

Phase 9 (Automation hardening) per `ARCHITECTURE.md` §17 — submission tracking
invariants (never double-submit), keeper hardening, DB-backed candidate state.