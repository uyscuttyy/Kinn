# Kinn

Kinn is a non-custodial, RWA-first inheritance vault for ERC-20-compatible tokenized real-world assets. Ordinary ERC-20 crypto assets use the same contract path as a secondary use case.

The owner controls the vault with a wallet. Telegram is the primary interface, but Telegram messages never authorize blockchain writes. The backend prepares transactions and reads chain state; the smart contract remains the final authority and no backend service stores user private keys.

## Current State

The following capabilities are implemented and tested:

- Single `KinnVault` contract with one vault per owner.
- Beneficiary addresses may be any valid wallet address; no pre-approval list is required.
- Exact beneficiary allocation validation using basis points.
- Check-in intervals bounded by the contract's configured maximum of nine weeks.
- Maximum missed check-ins bounded by five.
- ERC-20 deposits, partial/full withdrawals, multiple token tracking, and safe transfer handling.
- On-chain inheritance eligibility and dead-man-switch triggering.
- Per-token inheritance distribution, rounding remainder handling, duplicate-execution protection, and delayed retries for failed token transfers.
- Native automation reserve accounting and relayer reimbursement.
- Multi-network backend deployment registry.
- Telegram commands, wallet challenge verification, unsigned transaction preparation, reminders, and automation notifications.
- Hosted wallet page with browser-wallet/MetaMask support, mobile MetaMask deep-link fallback, and optional WalletConnect.
- First-party `KeyManager` wallet key infrastructure (Phase 5): strong-random secp256k1 keygen, AES-256-GCM + PBKDF2 encrypted at rest, non-extractable wrapping keys, lock/unlock model, EIP-191 message and transaction signing, and pluggable storage. Keys never leave the client or reach the backend. See [PHASE5_STATUS.md](PHASE5_STATUS.md).
- Backend contract layer re-pointed to the VaultFactory + per-owner instance model (Phase 6 milestone 6.1): factory `vaultOf` discovery, instance-scoped reads/writes, factory-targeting `createVault`, owner-scoped async prepares bound to the verified session wallet. See [PHASE6_STATUS.md](PHASE6_STATUS.md).

The X Layer testnet lifecycle and failed-transfer retry scenario are documented in [PHASE12_XLAYER_EVIDENCE.md](PHASE12_XLAYER_EVIDENCE.md). The AI parser remains optional and is currently disabled in the tested command-based flow.

## Local Commands

```bash
npm install
npm run build:backend
npm run test:backend
npm run test:contracts
npm run test
```

Run the local wallet page:

```bash
npm run wallet:serve
```

Run Telegram polling locally:

```bash
npm run telegram:poll
```

`build:backend` also builds `dist/wallet-client.js`; this is intentional because existing Render services may still use that build command.

## Deployment

Render uses `render.yaml`, but the package scripts are also compatible with an existing Render dashboard configuration:

```text
Build: npm install && npm run build:backend
Start: npm run wallet:start
```

Required hosted environment values include the Telegram token, chain deployment variables, `WALLET_CALLBACK_SECRET`, and `WALLET_APP_URL`. To expose WalletConnect, add a public Reown project ID:

```env
WALLETCONNECT_PROJECT_ID=your_reown_project_id
```

Never commit `.env` files, private keys, Telegram tokens, API keys, or callback secrets. Use [TESTNET_RUNBOOK.md](TESTNET_RUNBOOK.md) for deployment evidence and [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) for the restart checklist.

## Documentation Map

Active Web-App development target (Phases 2):
- [ARCHITECTURE.md](ARCHITECTURE.md): target architecture — Kinn Wallet (first-party) + Vault Factory + instances, state machine, DB/API/indexing/keeper (Phase 2).
- [CONTRACTS.md](CONTRACTS.md): contract architecture (Factory + instance, ETH/USDC, access control) (Phase 2).
- [SECURITY.md](SECURITY.md): security model, guarantees, adversarial testing matrix (Phase 2).
- [API.md](API.md): REST API for the Web App (Phase 2).
- [TESTING.md](TESTING.md): testing strategy across contracts/backend/E2E (Phase 2).
- [BASE_INTEGRATION.md](BASE_INTEGRATION.md): verified Base / Base Sepolia chain + USDC config (Phase 2).
- [AUDIT_PHASE1.md](AUDIT_PHASE1.md): Phase 1 repository audit and Phase 2 plan.

Phase status notes (current development track — smart contracts + first-party wallet):
- [PHASE3_STATUS.md](PHASE3_STATUS.md): Factory + per-owner instance contract rebuild.
- [PHASE4_STATUS.md](PHASE4_STATUS.md): comprehensive Foundry suite (121 tests) for the Factory + instance model.
- [PHASE5_STATUS.md](PHASE5_STATUS.md): first-party `KeyManager` wallet key infrastructure (COMPLETE).
- [PHASE6_STATUS.md](PHASE6_STATUS.md): backend/DB/API phase — factory+instance backend re-pointing (milestone 6.1 complete, in progress).

Preserved prior work (Telegram is frozen; do not modify):
- [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md): founder handoff, current status, restart order, and remaining work.
- [PHASE0_DESIGN.md](PHASE0_DESIGN.md): architecture and product decisions.
- [PHASE12_XLAYER_EVIDENCE.md](PHASE12_XLAYER_EVIDENCE.md): X Layer testnet lifecycle evidence.
- [SECURITY_REVIEW.md](SECURITY_REVIEW.md): contract security review and residual risks.
- [FINAL_REVIEW.md](FINAL_REVIEW.md): Phase 13 security and UX review.
- [TESTNET_RUNBOOK.md](TESTNET_RUNBOOK.md): deployment and lifecycle test procedure.
