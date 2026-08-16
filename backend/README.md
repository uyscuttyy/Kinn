# Kinn Backend Foundation

This Phase 6 backend is deliberately non-custodial. It contains no private-key loading, signer, transaction broadcast, or owner-action authority.

Components:

- `KinnContractService`: reads authoritative on-chain vault state and prepares unsigned calldata for wallet signing.
- `EthersRpcClient`: read-only JSON-RPC transport.
- `KinnEventMonitor`: block-range event polling with a replaceable durable cursor repository.
- `config`: validated RPC, chain, contract, and port settings.
- `DeploymentRegistry`: supports multiple Kinn deployments without hard-coding a single network.
- `WalletAuthService`: EIP-712 wallet ownership challenges bound to Telegram ID, chain ID, contract address, nonce, and expiry.
- `AuthenticatedKinnApi`: requires a verified wallet session before preparing owner transactions. The wallet must still sign and broadcast the resulting transaction.
- `TelegramBotService`: command and basic natural-language routing for Telegram. It sends reads and unsigned signing requests; it never authorizes a write itself.
- `OpenAiIntentInterpreter`: optional strict-JSON-schema intent extraction. Every output passes deterministic address, percentage, timing, and amount validation before Telegram can prepare an unsigned transaction.
- `ReminderService`: read-only deadline monitoring with deduplicated Telegram notifications for due, missed, and inheritance-eligible vaults.
- `AutomationWorker`: idempotent trigger, per-token distribution, and retry orchestration through an injected relayer. It re-reads contract state and waits for confirmation after submissions.
- `EthersRelayerSubmitter`: production submission adapter using an injected managed signer. Kinn does not load or persist a raw relayer private key.

Database implementations in later phases should store only wallet/Telegram associations, notification preferences, transaction status, cached projections, and event cursors. Contract state remains authoritative.

Run:

```bash
npm run build:backend
npm run test:backend
```

`npm run build:backend` also builds the browser wallet bundle at `dist/wallet-client.js`. The hosted wallet supports injected browser wallets and optional WalletConnect. Configure `WALLETCONNECT_PROJECT_ID` to expose the WalletConnect option; it is a public Reown project identifier, not a private key.

The full project restart checklist is in [../PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md).

The environment template targets Base Sepolia as a development default. A deployed contract address is required before live RPC reads can be performed.
