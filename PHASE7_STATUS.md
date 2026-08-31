# Kinn — Phase 7 Status Note

Status: COMPLETE · 2026-08-31

Phase 7 deployed the Factory + instance contracts to **Base Sepolia** (chain
`84532`) and wired the deployment into the environment-driven configuration.
The deployer key was supplied via `KINN_DEPLOYER_PRIVATE_KEY` in the local
(untracked) `.env`; Foundry read it inside the script via `vm.envUint` — it was
never placed on a command line, printed, or committed.

## Deployment (verified on-chain)

| Item | Value |
|---|---|
| Network | Base Sepolia (chainId 84532) |
| Contract | `KinnVaultFactory` |
| Address | `0x9C90d4eC5237099dFBA1CAE625e3BB9A14596421` |
| Transaction | `0x55fe7236d8399498ef7828255f6e80d915c612d3f89fc5fb4e6d2a46b7febc7b` |
| Block | 46,206,067 |
| Status | `1` (success) |
| Gas used | 3,938,067 |
| Automation fee | `1e15` wei (0.001 ETH) — testnet-proportionate |
| Deployer | `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB` (spent ≈0.000024 ETH) |
| Explorer | `https://sepolia.basescan.org/address/0x9C90d4eC5237099dFBA1CAE625e3BB9A14596421` |

Post-deploy on-chain reads (via `cast call` on the public RPC):
`vaultCount() = 0`, `automationFeeWei() = 1e15`,
`vaultOf(deployer) = 0x0`, deployed bytecode present (~36 KB).

## End-to-end smoke test (Phase 6 backend ↔ live chain)

The Phase 6 `KinnContractService` was pointed at the live factory through the
public RPC: `getFactoryAutomationFee()` returned `1000000000000000`,
`discoverVault(deployer)` returned `null` (no vault yet), `isVault()` behaved,
the supported-asset resolver produced `ETH@0x1111…1111` +
`USDC@0x036C…dCF7e`, and `prepareCreateVault` encoded `createVault` calldata
(`0x3a7a27f0…`) for the wallet to sign. **Backend ↔ contract integration is live.**

## Configuration changes

- `foundry.toml`: added `[rpc_endpoints]` with `base_sepolia = "${KINN_BASE_SEPOLIA_RPC_URL}"`
  (plain `${VAR}` — this forge build does not support `:-` defaults).
- `.env` (untracked) additions:
  `KINN_AUTOMATION_FEE_WEI=1000000000000000`,
  `KINN_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`,
  `KINN_BASE_SEPOLIA_CONTRACT_ADDRESS=0x9C90…96421`,
  `KINN_BASE_SEPOLIA_CHAIN_ID=84532`,
  `KINN_BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
  With these set, the backend multi-network registry
  (`KINN_NETWORKS=base-sepolia` + `KINN_BASE_SEPOLIA_*`) runs the REST API
  against the deployment (`npm run api:serve`).

## Operational notes learned

- The service shell exports `.env` variables itself; Foundry's dotenv does not
  override pre-set variables. An empty inherited `KINN_AUTOMATION_FEE_WEI`
  shadowed the `.env` value during the first attempt — resolved by passing the
  value explicitly on the forge invocation. If a forge read of an `.env` value
  comes up empty, check the process environment first.
- When appending to `.env`, verify a trailing newline first; a bare `>>` merge
  can corrupt the last line (a `WALLET_CALLBACK_SECRET` merge was caught and
  repaired byte-for-byte during this phase — re-verify the callback secret
  matches between services before relying on it).

## Deployment runbook (repeatable)

```bash
# 1. Ensure the deployer has Base Sepolia ETH (faucet), then:
# 2. Deploy (reads KINN_DEPLOYER_PRIVATE_KEY + KINN_AUTOMATION_FEE_WEI from .env):
forge script script/DeployKinn.s.sol --rpc-url base_sepolia --broadcast -vv
# 3. Verify reads:
cast call <FACTORY> 'vaultCount()(uint256)' --rpc-url https://sepolia.base.org
cast call <FACTORY> 'automationFeeWei()(uint256)' --rpc-url https://sepolia.base.org
# 4. Point the backend at it: set KINN_BASE_SEPOLIA_* (see BASE_INTEGRATION.md).
```

Contract source verification on Basescan is pending an API key (not required
for testnet operation).

## Next

Phase 8 (Indexing) per `ARCHITECTURE.md` §17 — durable-cursor event indexing of
`VaultCreated` and instance events, powering `/wallet/transactions` and
`/vaults/:owner/activity`.

## Security note

`.env` (with the deployer key, Telegram token, and OpenAI key) remains untracked
and gitignored; treat anything that has ever left the secret environment as
compromised and rotate it (per `PROJECT_HANDOFF.md`).