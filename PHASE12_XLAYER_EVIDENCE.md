# Phase 12 — X Layer Testnet Evidence

Network: X Layer testnet  
Chain ID: `1952`

## Deployments

- KinnVault: `0x716348fb2D40f96E8511E27Cf833a0d8E6F52Fa8`
- KinnVault deployment transaction: `0xf04de910881f926fe20f7fbd5e7d5b50df5159ba49e887f2ddb740fa71019245`
- Test RWA token (`Kinn Test RWA`, `tRWA`): `0xa271CA6aB244cc965BA0eCf1Eb6f1b1d19C22eda`
- Automation fee: `1000000000000000` wei (`0.001 OKB`)

## Test vault

- Owner: `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB`
- Check-in interval: 60 seconds (Phase 12 accelerated test only)
- Maximum missed check-ins: 1
- Initial automation reserve: `0.01 OKB`
- Vault creation: `0x50836e8b26ec0898a73134671c2c648782e08a6dec73a51a031e09923f83c213`
- Token approval: `0x73c41ed331a9164e9bfee5ceadad03dc5d9dca77732a31d77b2009aea7edb9c9`
- Deposit (10,000 tRWA): `0x6ea6678493668875fe949ff5b9c06dfd5d386fb5c45008740fabbd0f28f4ff95`
- Owner check-in: `0x49ee6fc447e2f251d68f402be1cedc64b680750aff186ea989d78c0dbda3f947`
- Inheritance trigger: `0x28098fe8574a77b1cd08aeab1d816f6d6f30b000e27b6c369eec7ed7ac9a4ccf`
- Token distribution: `0x3e0d5e9701f916fbb0bf2fa394ab2807fb9e0a4227aba538d18e49114113d8a2`
- Remaining reserve claim: `0xb511848f27ea8aeaa2caae9f4d706cd0482adb32085c081a47793963720398f5`

## Beneficiary results

- Alice `0xb2cc4A7C05ebb40d1D9af79BFdaF9300335808B8`: 5,000 tRWA (50%)
- Bob `0x5b4b4D678387b90fc4482F291ddBC20A9C577843`: 3,000 tRWA (30%)
- Charlie `0xFDB1B6F4d658EAF3992bE2d96697Db39ee9ABDB3`: 2,000 tRWA (20%)
- KinnVault final tRWA balance: 0
- Final vault state: inactive, inheritance triggered
- Duplicate trigger: reverted with `InheritanceAlreadyTriggered`
- Final automation reserve: 0

## Outstanding Phase 12 evidence

- Live WalletConnect pairing and signed-transaction confirmation after a Reown project ID is configured.
- Live AI intent parsing remains optional. The command-based Telegram product works with AI disabled.

## Telegram vault automation run (2026-08-14)

- Owner / automation candidate: `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C`
- Beneficiary: `0x2ff06249C8aaB3B75060B3c25DCeB65ABBBB76DB` (100%)
- Asset before execution: 75 tRWA
- Check-in interval: 60 seconds (accelerated test only)
- Maximum missed check-ins: 1
- Telegram reminder: inheritance-eligible notification delivered
- Inheritance trigger: `0x070c9613bd63272f04d572a1fdc2fdd7fcd38d6558d79143fdb8e92f3a4ef8c7` (block 38276515)
- Token distribution: `0x7935795a2f232ec52c5d97e0e406566c9ee3247e7886557041ca993836b02ccf` (block 38276535)
- ERC-20 transfer: 75 tRWA from KinnVault to the beneficiary
- Remaining reserve claim: `0x14bad46394b714a581b70ce5fad123b075359145326d8988f357dcafaa1446b5` (block 38276552)
- Final vault state: inactive, inheritance triggered
- Final KinnVault tRWA balance: 0
- Pending beneficiary inheritance: 0
- Token distribution marked processed: true
- Final automation reserve: 0
- Duplicate inheritance trigger: reverted

## Failed-transfer and delayed-retry run (2026-08-14)

- Testnet-only scenario vault owner: `0x59DDDA17c1F0Ac2acd2F50f0239faDBDD8718Fa7`
- Testnet-only failing RWA token (`rtRWA`): `0xBE1D38F0AC5A8987a9c243EeCA512038d0F0AaBe`
- Beneficiary: `0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C` (100%)
- Deposited amount: 75 rtRWA
- Initial automation reserve: `0.005 OKB`
- Retry interval: 60 seconds (accelerated test only)
- Inheritance trigger: `0x772fc9acb9b24b4c18d9a2944c7ee73cf6c7be32b102d3c92aea94c6c55b39b0` (block 38277914)
- Initial distribution attempt: `0x9a04e634bbef952bc0e9387e324698b077ea2c093bf52e7638766d5858852af4` (block 38277933)
- State after failed transfer: 75 rtRWA pending, 75 rtRWA held by KinnVault, beneficiary balance 0
- Transfer re-enabled: `0x84475f5e0c64f392cf7fc78dca5131f29acfb788d190a33ed2f048f789d61baa`
- Delayed retry: `0x82a6c51652e36c87c93b11512fb8c8f77592cacf795af706e3a6a452515933a0` (block 38278286)
- Remaining reserve claim: `0xda68bc79067224368ccfe81f3343a0dc98c3d9bbf9505eddf2846c967c60e01b` (block 38278302)
- Final beneficiary balance from scenario: 75 rtRWA
- Final KinnVault rtRWA balance: 0
- Final pending inheritance: 0
- Final automation reserve: 0
- Relayer was distinct from the scenario vault owner

## AI integration configuration

- `OPENAI_API_KEY`: configured (value intentionally not recorded)
- `KINN_AI_ENABLED`: `false` so command-based Telegram operation remains available
- `KINN_OPENAI_MODEL`: `gpt-5.6-sol`
- `OPENAI_BASE_URL`: `https://agentrouter.org/v1`
- Agent Router `/models` and Responses API checks both returned HTTP 401 `unauthorized_client_error`.
- A working Agent Router credential is required before AI parsing can be enabled.
