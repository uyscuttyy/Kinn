# Kinn Phase 12 Testnet Runbook

This runbook is for testnet only. The recorded deployment is X Layer testnet, chain ID `1952`. See [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) before resuming development.

## Base Sepolia deployment (Phase 7, live)

> **Phase 11 update:** this factory was built from an older contract revision —
> vaults created through it revert on ERC-20 `deposit`. A fresh factory with the
> current contracts was deployed in Phase 11 and is the one the backend now
> targets; see [PHASE11_STATUS.md](PHASE11_STATUS.md).

| Item | Value |
|---|---|
| Factory | `0x9C90d4eC5237099dFBA1CAE625e3BB9A14596421` |
| Tx | `0x55fe7236d8399498ef7828255f6e80d915c612d3f89fc5fb4e6d2a46b7febc7b` |
| Block | 46,206,067 |
| Automation fee | 0.001 ETH (1e15 wei) |
| Explorer | https://sepolia.basescan.org/address/0x9C90d4eC5237099dFBA1CAE625e3BB9A14596421 |

Backend env to run against it (see `BASE_INTEGRATION.md`):

```env
KINN_NETWORKS=base-sepolia
KINN_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
KINN_BASE_SEPOLIA_CHAIN_ID=84532
KINN_BASE_SEPOLIA_CONTRACT_ADDRESS=0x9C90d4eC5237099dFBA1CAE625e3BB9A14596421
KINN_BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
KINN_AUTOMATION_FEE_WEI=1000000000000000
```

Then `npm run api:serve` and exercise `/api/v1/base-sepolia/*`. Full evidence in [PHASE7_STATUS.md](PHASE7_STATUS.md).

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
