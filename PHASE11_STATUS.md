# Kinn — Phase 11 Status: E2E on Base Sepolia (§17)

Status: COMPLETE · 2026-09-02

Full lifecycle executed against **live Base Sepolia** (chain 84532) through real
transactions, using the Phase 11 E2E runner (`backend/scripts/e2eLifecycle.ts`,
`npm run e2e:lifecycle`). Exit code 0; final on-chain state `Distributed`.

## Deployment used (fresh, current contracts)

| Item | Value |
|---|---|
| Factory | `0x672778401F0F550284347Bf32aB883B4a2A72933` |
| Deploy tx | `0x978a8c9ba1d8f92e3aec8523931163aecfcf83f528339bfe4bc14157634d62e9` |
| Automation fee | 0.001 ETH (1e15 wei) |
| Test token (KE2E, 18 dec) | `0x9f0F6f9D89a63481B446e6522d923C09f5126399` |
| Vault | `0x5d0D79a0B5B45b99a81e5d31449Ff37D0C321A34` |
| Owner | `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C` |
| Keeper (relayer) | `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB` |
| Beneficiaries (70% / 30%) | `0x8012bdDC12d09Dd7D0D5bF4872eD6a233C9cFF27` / `0xB15d1800e6d8105d14e1323849f884005425D121` |

A fresh factory was deployed because the Phase 7 factory (`0x9C90d4eC…96421`)
was built from an older contract revision: vaults created through it revert on
ERC-20 `deposit` with `TokenTransferFailed` even with correct balance/allowance.
The Phase 7 address remains as historical evidence only; the backend config
(`.env` `KINN_BASE_SEPOLIA_CONTRACT_ADDRESS`) now points at the fresh factory.

## Lifecycle evidence (tx hashes)

| Step | Tx |
|---|---|
| Token deploy | `0x4966df8a5913407d695d7f87f18eac84536d6f5dcef50d876c8e86c0fe4d2db4` |
| Token mint (owner) | `0x2ffd7bf7a60fa2026d9e20834d80b03f0e4f012cd095f8ec1618247164a874b3` |
| Vault create | `0x4338e448874e3032ea796fac17aec23ad38f14e72b005ce471b5837e2f998d93` |
| Reserve top-up | `0xbbf8025f582f887ee7f264d43901502f743462196176525d6a8be20420f083b4` |
| ETH deposit | `0x793c530387d54f7799082b71435cbb8985287857bf7be6b6422a792094fd70da` |
| Token approve | `0x65f9a43d86efe61e0181424275f215de2208f29bd4afcf3109ccff2bf83b7e68` |
| Token deposit | `0x36f2e0fc7e241a82a9977d3cea7f443b107279c5ee161c160bf0a50e0e3e5328` |
| Check-in | `0xfff0ca7dd6bac0e238544ff371413cb7d39900777a3afed8edcc42cf13cb7830` |
| Inheritance trigger (keeper) | `0x7651760062d5c65b8dc189c5afac30e3601a933d6ec0815235995b25b1430299` |
| Distribute token (keeper) | `0x03abdbb3e2dad4f8dcc10dc23ff640d4c50c7ad77bbacca565e748836f6f702f` |
| Distribute ETH (keeper) | `0x9519e7c578f924830fa2e54d3d154b427b1b7c16a1ada8809d3ee8c8ca1c40c7` |

## Verified behaviors

- **On-chain eligibility**: vault sat `Active` for the full configured window
  (300s interval × 1 max-missed, deadline 1788338164); eligibility arrived
  exactly at the on-chain deadline — no backend shortcut existed.
- **Permissionless keeper**: trigger + both distributions were submitted by the
  relayer address, not the owner; the contract accepted them purely on state.
- **Duplicate trigger rejected**: second `triggerInheritance()` reverted
  (`InheritanceAlreadyTriggered`) — logged as adversarial evidence.
- **Exact distribution**: ETH 0.00005 → 0.000035 / 0.000015 (70/30); token 10 →
  7 / 3 (70/30). No pending entitlements remained; retry loop not needed.
- **Automation reserve reimbursement**: reserve was consumed by
  `_payAutomationFee` reimbursements to the keeper across the maintenance calls
  (keeper's gas was covered; nothing left to claim at completion, which the
  runner reports explicitly).
- **Final state**: `Distributed` (all assets processed, zero pending).

## Runner hardening (added during this phase)

- Resumable: every step checks live chain state and skips if already done.
- Settle delay after each confirmed tx + retrying reads — the public RPC
  intermittently served empty (`0x`) responses for reads immediately after a
  confirmation (twice during bring-up; retries resolved both).
- Explicit role overrides (`KINN_E2E_OWNER_PRIVATE_KEY` /
  `KINN_E2E_KEEPER_PRIVATE_KEY`) and `FUNDING_REQUIRED` preflight gate.
- State (beneficiary keys, token address, check-in marker) persisted in
  `.e2e-state.json` (gitignored) so resumes stay consistent.
