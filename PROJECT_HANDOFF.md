# Kinn Founder Handoff

Updated: 2026-08-16

This is the restart point for Kinn. The project is paused after the current testnet and hosted-wallet work so it can continue later as a founder-led product.

## Product Direction

Kinn is an RWA-first, non-custodial inheritance vault for ERC-20-compatible tokenized real-world assets. Ordinary ERC-20 crypto assets use the same path as a secondary use case. Kinn does not custody private keys, enforce beneficiary pre-approval, or replace an RWA issuer's legal and compliance controls.

## Architecture

```text
Telegram user
  -> Telegram bot and optional AI parser
  -> non-custodial backend
  -> wallet challenge or unsigned transaction
  -> browser wallet / MetaMask / WalletConnect
  -> KinnVault contract
  -> ERC-20 RWA or crypto token
```

The contract is authoritative. The backend can read state, prepare calldata, monitor events, send reminders, and submit permissionless maintenance calls. It cannot withdraw owner assets or impersonate an owner.

When the dead-man switch becomes eligible, the contract first marks inheritance triggered and the vault inactive. Each token is then distributed separately. Failed beneficiary transfers remain pending in Kinn for later retry; the relayer cannot change the stored recipient or amount.

Automation gas is reimbursed from a native-token reserve funded by the vault owner. This reserve is separate from inherited ERC-20 assets. Creator/service monetization is a future decision and is not implemented.

## Completed Work

- Phases 0-5: design, vault foundation, ERC-20 assets, check-ins, inheritance, and contract security review.
- Phases 6-11A: backend, wallet authentication, Telegram, optional AI, reminders, automation, retries, and automation reserve.
- Phase 12: X Layer testnet lifecycle, Telegram automation lifecycle, and failed-transfer delayed-retry scenario completed.
- Phase 13: security and UX review completed with residual risks documented.
- Hosted wallet: Render deployment with MetaMask/browser wallets, mobile MetaMask handoff, secure Telegram callbacks, and optional WalletConnect.

## Resume Order

1. Check GitHub `main` and Render service health.
2. Rotate any credentials that have ever appeared outside the secret environment.
3. Confirm `WALLET_CALLBACK_SECRET` matches between the wallet service and Telegram backend.
4. Add `WALLETCONNECT_PROJECT_ID` in Render to expose WalletConnect.
5. Test `/connect`, `/verify`, `/status`, `/checkin`, `/approve`, `/deposit`, `/withdraw`, and `/vault` on X Layer testnet.
6. Run `npm run test` and `npm run build:backend` before new code changes.
7. Complete a live WalletConnect pairing and signed-transaction test.
8. Add future networks through the deployment registry; do not hard-code X Layer assumptions.
9. Before using real value, complete an independent Solidity audit, production database/authentication work, monitoring, legal/RWA issuer review, and a mainnet release checklist.

## Remaining Work

- Live WalletConnect QR/deep-link pairing test after a Reown project ID is configured.
- Improve verification so users do not manually return `/verify <nonce> <signature>` to Telegram.
- Durable encrypted production storage for sessions, preferences, event cursors, transaction history, and audit records.
- Telegram webhook deployment, authentication, rate limits, and operational monitoring.
- Verify BOT Chain and X Layer mainnet chain data, explorers, gas behavior, contract deployments, and automation fees from official sources.
- Keep AI optional until a working provider and deterministic validation tests are available.
- Independent contract audit and legal/compliance review before handling real RWA value.

## Known Constraints

- Fee-on-transfer, rebasing, reflection, blacklist, freeze, and issuer-controlled destructive tokens are not guaranteed to work.
- Issuer restrictions can leave inheritance pending indefinitely; Kinn cannot bypass token issuer controls.
- Accelerated 60-second intervals are testnet-only. Production settings should use intended multi-day or multi-week periods.
- The AI flow is not required for command-based Telegram operation and was disabled in the validated test flow.

## Security Reminder

Never commit `.env`, private keys, Telegram tokens, API keys, or callback secrets. Treat any real-looking credential previously placed in an example file or shared workspace as compromised and rotate it.

## Important Files

- `src/KinnVault.sol`: main contract.
- `backend/src/`: backend, Telegram, reminders, automation, and wallet server.
- `backend/wallet-client/client.ts`: browser wallet and WalletConnect client.
- `script/`: deployment and testnet scripts.
- `test/` and `backend/test/`: contract and backend tests.
- `PHASE12_XLAYER_EVIDENCE.md`: testnet addresses, transactions, and outcomes.
- `SECURITY_REVIEW.md` and `FINAL_REVIEW.md`: security findings and residual risk.
