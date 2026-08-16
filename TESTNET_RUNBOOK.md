# Kinn Phase 12 Testnet Runbook

This runbook is for testnet only. The recorded deployment is X Layer testnet, chain ID `1952`. See [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) before resuming development.

## Required environment

```bash
export KINN_RPC_URL="<testnet RPC>"
export KINN_DEPLOYER_PRIVATE_KEY="<temporary funded deployer key>"
export KINN_AUTOMATION_FEE_WEI="<network-specific reimbursement>"
export WALLET_CALLBACK_SECRET="<shared wallet and Telegram callback secret>"
```

Never commit the deployer or relayer private key.

For the hosted authorization page, configure `WALLET_APP_URL` and the same `WALLET_CALLBACK_SECRET` in the wallet and Telegram environments. Add `WALLETCONNECT_PROJECT_ID` from Reown Cloud to enable WalletConnect; browser MetaMask remains available without it.

## Deploy

```bash
forge script script/DeployKinn.s.sol:DeployKinn \
  --rpc-url "$KINN_RPC_URL" \
  --broadcast \
  --verify
```

After deployment, configure the backend deployment registry with the confirmed chain ID, RPC URL, and contract address. Then run the lifecycle with funded test wallets for owner, beneficiaries, and relayer.

## Required evidence

- Deployment transaction and verified contract address
- Vault creation and automation reserve transaction
- ERC-20 approval/deposit transaction
- Owner check-in transaction
- Timestamp progression on the selected testnet (or a short-interval test deployment)
- Inheritance trigger transaction
- Per-token distribution transaction
- Beneficiary receipt balances
- Duplicate trigger rejection
- Final inactive vault state
- Telegram notification and wallet-signing screenshots/logs

## Hosted wallet smoke test

1. Send `/connect <network> <wallet>` in Telegram.
2. Open the generated authorization URL and verify its network and wallet details.
3. Test browser MetaMask, then test WalletConnect after configuring the Reown project ID.
4. Return the generated `/verify <nonce> <signature>` command to Telegram.
5. Prepare `/checkin` or another write and sign it from the authorization page.
6. Confirm the transaction on-chain and confirm that Telegram receives the secure callback message.
