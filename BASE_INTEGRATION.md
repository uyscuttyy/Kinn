# Kinn — Base Integration (verified config)

Status: COMPLETE · 2026-08-28. All values below were verified from `ethereum-lists/chains` (canonical EIP-155 registry) and confirmed live with `eth_call` against the public RPCs. Do not replace these with guessed values; if they change, re-verify against official sources before use.

## Mainnet

| Item | Value |
|---|---|
| Name | Base |
| chainId / networkId | 8453 |
| Native currency | ETH, 18 decimals |
| Public RPC | `https://mainnet.base.org` |
| Public RPC (fallback) | `https://base-rpc.publicnode.com` |
| Explorer | `https://basescan.org` |
| USDC (native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDC decimals | 6 |
| USDC symbol | USDC (verified via eth_call) |

Note: Base has both a **bridged** USDC (older) and a **native** USDC (Circle, since 2023). Kinn targets the **native** contract above for the initial asset set.

## Testnet (dev/test target)

| Item | Value |
|---|---|
| Name | Base Sepolia |
| chainId / networkId | 84532 |
| Native currency | Sepolia ETH, 18 decimals |
| Public RPC | `https://sepolia.base.org` |
| Public RPC (fallback) | `https://base-sepolia-rpc.publicnode.com` |
| Explorer | `https://sepolia.basescan.org` |
| USDC (native) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| USDC decimals | 6 |
| USDC symbol | USDC (verified via eth_call) |

## How these were verified (reproducible)

1. Canonical chain metadata: `https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-8453.json` and `eip155-84532.json`.
2. USDC identity confirmed by `eth_call`:
   - `symbol()` -> `USDC`
   - `name()` -> `USD Coin`
   - `decimals()` -> `6`
   Using RPC `https://mainnet.base.org` (mainnet) and `https://sepolia.base.org` (Sepolia).

## Env shape for this network

```
KINN_NETWORKS=base-sepolia
KINN_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
KINN_BASE_SEPOLIA_CHAIN_ID=84532
KINN_BASE_SEPOLIA_CONTRACT_ADDRESS=<deployed factory address — Phase 7>
KINN_BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
# production network mirrors with the same keys and 8453 values.
```

## Remaining-verification items for Phase 7 (deployment time)

- Favourable gas limits/fees for vault create + distribute on Base (measure with real calls; the existing 200k transfer cap and per-token distribution were validated on X Layer, re-measure on Base).
- Confirm Base `eth_getBlock` `safe`/`finalized` fields for indexing confirmation depth.
- Confirm no USDC-specific quirks (USDC is standard ERC-20; no fee-on-transfer) — the audit only claims support for this exact contract.