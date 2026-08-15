# Kinn Phase 12 Testnet Runbook

## Required environment

```bash
export KINN_RPC_URL="<testnet RPC>"
export KINN_DEPLOYER_PRIVATE_KEY="<temporary funded deployer key>"
export KINN_AUTOMATION_FEE_WEI="<network-specific reimbursement>"
```

Never commit the deployer or relayer private key.

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

