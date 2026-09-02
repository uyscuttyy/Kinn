# Kinn — REALDEPLOYMENT.md — Going Live

Audience: the next builder taking Kinn from a proven testnet system to production.
Current state: all phases (3–11) are complete, including a **full end-to-end
lifecycle test on live Base Sepolia** (see `PHASE11_STATUS.md`) and the Phase 10
security review (`PHASE10_STATUS.md`, `SECURITY.md`). Nothing below is optional.

## 0. The one hard gate

> **No real funds without an independent third-party security audit.**
> Every phase document repeats this. The Phase 10 review is internal
> (static analysis + manual review + 121 contract tests incl. invariant/fuzz/
> adversarial suites). It is not a substitute for an external audit
> (SECURITY.md §5). Budget for it before anything else.

## 1. Mainnet contract deployment (Base mainnet, chain 8453)

1. Source config from official Base docs only — chain ID `8453`, a paid RPC
   provider (Alchemy/Infura/QuickNode). Never ship a free public RPC.
2. Decide `automationFeeWei` against real Base mainnet gas (testnet used
   0.001 ETH; on mainnet Base gas is tiny — review `SECURITY_REVIEW.md` notes).
3. Confirm the 50-beneficiary cap and per-token distribution gas against
   mainnet block gas limits (testnet evidence: `PHASE11_STATUS.md`).
4. Deploy `script/DeployKinn.s.sol` with a **hardware wallet or multisig** —
   never a hot private key from `.env`. Verify on Basescan.
5. Record factory address, tx hash, fee, and USDC address in this runbook and
   in the deployment registry config (`loadNetworkConfigs.ts` / `.env`).
6. Re-run the E2E runner against mainnet with dust amounts as a smoke test
   (`npm run e2e:lifecycle` — see hardening notes in `PHASE11_STATUS.md`).

## 2. Backend operations

- **Hosting**: Node >= 22.15. Run three processes: `api:serve` (HTTP API),
  `indexer:run` (event indexing), `automation:run-once` (keeper — schedule it,
  e.g. every 1–5 min via cron/queue). Process manager with restarts
  (systemd/Docker + orchestrator).
- **Database**: the durable document-store layer exists
  (`backend/src/db/*`) but must run on a managed DB with backups. Blockchain
  remains the source of truth; the DB is index/cache.
- **Relayer key**: move `KINN_RELAYER_PRIVATE_KEY` behind a managed signer/KMS.
  It is a hot key by design — fund it with a small amount and auto-replenish.
  It can never move user funds (only permissionless keeper calls), but it is
  still a live credential.
- **Secrets**: never commit; rotate anything that has ever appeared in a
  workspace. `WALLET_CALLBACK_SECRET`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`,
  RPC keys all come from a secret manager.
- **Monitoring/alerts**: indexer lag, keeper failures, relayer balance,
  API error rate, pending-distribution age (a stuck pending entitlement is a
  liveness signal — issuer freezes are a documented limitation, not a bug).

## 3. Frontend

The only product-facing surface today is the hosted wallet page
(`backend/wallet-client/client.ts`, built by `npm run build:wallet-client` and
served by `wallet/server.ts`). It is a smoke-test page. Build the real Web App
against the HTTP API — `FRONTEND.md` is the complete briefing for that work.
The API already returns every write as an **unsigned transaction** for the
wallet to sign/broadcast; a frontend requires **zero backend or contract
changes**.

## 4. Legal / product

- Terms of service and privacy policy (inheritance-adjacent product).
- Decide supported assets for launch: the tested set is ETH + USDC
  (`SECURITY.md` §4: fee-on-transfer/rebasing tokens are unsupported).
- Beneficiary UX must respect on-chain caps: ≤ 50 beneficiaries, allocations
  must total exactly 10000 bps.

## 5. Pre-launch checklist

- [ ] External audit completed and findings resolved
- [ ] Mainnet factory deployed + verified (hardware/multisig deployer)
- [ ] Deployment registry / `.env` pointed at mainnet, paid RPC
- [ ] Relayer hot wallet funded + replenishment automation + KMS-backed key
- [ ] Managed DB provisioned, backups verified
- [ ] Indexer + keeper running with alerts (incl. pending-age alert)
- [ ] Frontend live against `/api/v1/base/...`
- [ ] Telegram optional; verify `WALLET_APP_URL` + callback secret
- [ ] Incident runbook (keeper down, RPC down, stuck distribution)
- [ ] Optional: bug bounty

