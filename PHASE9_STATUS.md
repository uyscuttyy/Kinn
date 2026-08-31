# Kinn — Phase 9 Status Note

Status: COMPLETE · 2026-08-31

Phase 9 hardens the automation/keeper path (ARCHITECTURE §14): the tracked
**never-double-submit** invariant, crash recovery of in-flight submissions, a
durable candidate registry, and an ingestion lock.

## What was built

### `backend/src/db/DurableSubmissionLedger.ts` (§14 “never double-submit is a tracked invariant”)
- Durable **double-submit gate** keyed by *logical action*
  (`${candidateId}:kind:asset:beneficiary`), not transaction hash.
- States: `pending` → `confirmed` | `reverted`.
  - `pending` — a transaction for this action is in flight; a crash between
    submit and receipt-resolution is recovered by **waiting on the stored hash**
    instead of submitting again.
  - `confirmed` — skip (already succeeded on-chain).
  - `reverted` — safe to retry.
- Registered `app_data` (keeper bookkeeping); the contract remains the final
  authority even if the ledger is lost.

### `AutomationWorker` hardening
- Every `submit` now goes through a `SubmissionGate` (durable in production,
  in-memory default) with three decisions: **submit / wait / skip**. Skipped
  actions emit no transaction and no `submitted` count.
- **Crash recovery**: a pending action resolves the recorded hash via the
  relayer's `wait`, recording it as `(recovered pending submission)`.
- **Ingestion lock**: concurrent `runOnce` calls are refused (`skipped:true`)
  instead of racing on the same candidates (the API.md `/automation/run` lock).
- Action keys make distribute/retry per-asset and per-beneficiary, so one
  token's outcome never gates another's.

### `backend/src/db/DurableAutomationCandidateRepository.ts`
- Durable keeper-candidate registry (`add`/`remove`/`listCandidates`) replacing
  the process-env-only in-memory list; `runOnce.ts` seeds it from
  `KINN_AUTOMATION_CANDIDATES` for ops parity.

## Verification

New `AutomationWorker.test.ts` cases (5) plus the durable-ledger persistence
case: confirmed action **skipped** on later passes (no second transaction);
crash-between-submit-and-wait **recovers** the pending hash without re-submitting;
reverted action **retried**; concurrent `runOnce` **refused** via the lock;
ledger `pending`→`confirmed` survives store restarts.

- `tsc` → OK · `npm run build:backend` → OK · `npm run test:backend` → **98/98**.
- Contracts untouched (Phase 9 is service-layer hardening; `npm run test:contracts`
  unchanged at 121/121).

## Next

Phase 10 (Security) per `ARCHITECTURE.md` §17 — the static/adversarial review
pass over the rebuilt contracts + backend (the two remaining
`forge-lint unsafe-typecast` warnings and any residual backend risks live here).