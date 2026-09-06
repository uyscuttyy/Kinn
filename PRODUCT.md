# Kinn — Product Definition

Kinn is a non-custodial inheritance vault with a first-party wallet. One
product, two promises: your crypto stays spendable by you today, and passes
to your chosen people automatically if you ever stop showing up. No
custodian, no paperwork, no trusted third party — the smart contract is the
executor.

## The problem

Crypto inheritance today is either "write your seed phrase in an envelope"
(fragile, all-or-nothing, no conditions) or a custodial service (reintroduces
exactly the counterparty risk crypto was meant to remove). Neither is
acceptable for meaningful assets.

## The product

A user creates a Kinn wallet in the browser, opens a personal vault contract,
sets a check-in schedule, names beneficiaries with percentage shares, and
deposits ETH and USDC. One signature per period keeps the vault alive. If the
owner stops checking in for the configured number of periods, anyone —
including Kinn's automated keeper — can trigger inheritance, and the contract
distributes every asset per the stored allocations. Until that trigger, the
owner can deposit, withdraw, change beneficiaries, change the schedule, or
close an empty vault at will. After it, the vault is frozen and the payout
runs to completion, with failed deliveries recorded and retried rather than
lost.

## System components

**VaultFactory + KinnVault (Solidity, Base Sepolia).** One factory per chain
(`0x672778401F0F550284347Bf32aB883B4a2A72933`, chain 84532) deploys one vault
instance per owner via CREATE2. Each instance carries its own owner,
beneficiaries, balances, check-in clock, and inheritance state machine:
Active → Missed → Eligible → Distributing → Distributed, plus Closed. The
contract alone authorizes ownership, allocations, eligibility timing, and fund
movement. 121 contract tests pass, including invariant, fuzz, and adversarial
suites (double-distribution, early trigger, non-owner writes, reentrancy,
malicious tokens, rounding).

**Backend API (REST, non-custodial).** Reads chain state, indexes events with
a durable cursor, prepares unsigned transactions, runs EIP-712 wallet-link
authentication, and operates the permissionless keeper (trigger, per-asset
distribution, retries, reserve claim) through a managed relayer signer. It
cannot sign owner transactions, custody keys, or move funds — a fully
compromised backend still cannot steal anything, and the contract
independently validates every keeper action. 98 backend tests pass, plus a
full on-chain E2E run recorded in PHASE11_STATUS.md.

**Web app (Vite/React/TS, 12 routes).** Landing, wallet creation, unlock,
vault dashboard, vault creation, check-in, deposit, withdraw, beneficiaries,
settings, activity, security. Five-color design system, mobile-first for the
actions that matter (check-in, balances, signing). All chain reads come from
the API; all writes are prepared by the API and signed in the wallet.

**First-party KeyManager wallet.** AES-256-GCM encrypted keys (PBKDF2,
210,000 iterations) stored only in the browser's localStorage; raw key
material exists transiently and is zeroized after use; keys auto-lock when
the tab hides. Signs EIP-712 login challenges, EIP-191 messages, and offline
transaction signing with locally-filled nonce/gas/fees. MetaMask and
WalletConnect remain as fallback signers only.

## Trust model (the core guarantee)

- The contract is the sole authority for ownership, allocations, timing, and
  fund movement.
- The backend prepares but never signs; the wallet signs but the contract
  verifies. Compromise of either one alone moves nothing.
- Simulation is advisory; only a confirmed on-chain receipt counts.
- Rounding remainder goes to the last beneficiary; every wei is accounted for.

## Costs

Users pay gas for their own transactions. Inheritance execution is paid from
each vault's automation reserve (topped up and withdrawable by the owner),
which reimburses the keeper per action. No protocol fees in testnet.

## Current status (September 2026)

Live on Base Sepolia end to end: factory deployed, backend serving, web app
building clean, KeyManager signing verified (EIP-712 recovery, valid RLP
transactions), auth/challenge/prepare/simulate loop verified against the
running backend. Relayer key provisioned and funded for keeper operations.

## Known gaps before mainnet

- Live funded-transaction test on Base Sepolia (everything up to broadcast
  is proven; the last step needs a funded owner wallet).
- Independent smart-contract audit (required before real assets).
- Production database, rate limiting, and secret management for hosted backend.
- WalletConnect pairing test with a configured project ID.
- Mainnet deployment addresses and USER_GUIDE network swap.
- USD price display (balances currently shown in native units).
- No key export/backup flow yet: a forgotten passphrase means an unusable
  wallet by design, but users need clearer warnings and optional backup.
