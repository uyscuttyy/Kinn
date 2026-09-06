# Kinn — User Guide

Kinn is a non-custodial inheritance vault. You set a check-in schedule, name
your beneficiaries, and deposit assets. As long as you keep checking in, the
vault stays yours. If you stop checking in for long enough, the vault
automatically distributes everything to your beneficiaries, exactly as you
allocated it. No lawyers, no paperwork, no one to call — the smart contract
executes your instructions.

Kinn never holds your keys and never holds your assets. Your key is encrypted
in your own browser. Your assets sit in your own vault contract on the
blockchain. If Kinn's servers disappeared tomorrow, your vault and your key
would be unaffected.

## Concepts

**Wallet.** Your Kinn wallet lives in your browser. It is created with a
passphrase that encrypts the key on your device. There is no seed phrase to
write down and no account to register — but there is also no password reset.
If you forget the passphrase, the key cannot be recovered by anyone.

**Vault.** One vault per wallet address. The vault is a smart contract that
holds your assets (ETH and USDC) and enforces your inheritance rules.

**Check-in.** A single transaction that tells the vault "I'm still here" and
restarts your timer. Checking in early is free of penalty — the clock simply
restarts.

**Beneficiaries.** The wallet addresses that inherit from you, each with a
percentage share. Shares must always total exactly 100%.

**Vault states.** Your vault is always in exactly one state, shown at the top
of your dashboard:
- Active — everything works: deposit, withdraw, check in, change settings.
- Missed — you missed at least one check-in, but you can still check in and
  reset the timer. Nothing is lost.
- Eligible — you missed enough check-ins that inheritance can now be
  triggered by anyone. Check in immediately if you do not want this.
- Distributing — inheritance was triggered. The vault is frozen and assets
  are being paid out to beneficiaries. This is permanent and irreversible.
- Distributed — every asset has been paid out. The vault is finished.
- Closed — you closed an empty vault. You may open a new one.

## Getting started

You need a web browser and a small amount of network currency (ETH on Base
Sepolia while Kinn is in testnet) to pay for your own transactions.

### 1. Create your Kinn wallet

Open the Kinn app and choose "Create Kinn wallet". Pick a label you will
recognize, then choose a passphrase of at least 8 characters. This passphrase
encrypts your key — Kinn never sees it and cannot recover it.

The app shows your new wallet address. This is a normal blockchain address:
it can receive ETH and USDC like any other wallet.

### 2. Fund your address

Send a small amount of ETH to your new address (about 0.02 testnet ETH covers
vault creation plus several check-ins and deposits). Without gas, your address
cannot send any transaction, including creating the vault.

### 3. Create your vault

Choose "Create a vault" and set two things:
- Check-in interval — how often you must check in (for example, every 30 days).
- Missed check-ins allowed — how many consecutive misses trigger eligibility
  (for example, 2).

Then add your beneficiaries: each one's wallet address and percentage share,
totalling exactly 100%. Confirm, and sign the creation transaction in your
wallet when prompted. Your vault deploys on-chain within seconds.

### 4. Deposit assets

Open your vault and choose Deposit. Pick ETH or USDC and enter an amount.
USDC asks for two signatures (an approval, then the deposit) — this is normal.
Your assets now sit in the vault contract, visible on the dashboard.

### 5. Check in

Press "Check in now" whenever your deadline approaches — the dashboard always
shows the time remaining. One signature, timer reset, done.

## Everyday use

- **Dashboard** — vault state, time remaining, last check-in, asset balances,
  beneficiaries, and quick actions. This is your home screen.
- **Check-in page** — a focused one-tap screen, designed for mobile. Bookmark
  it if you like.
- **Deposit / Withdraw** — move assets in and out. Withdrawals work until
  inheritance is triggered, after which the vault is frozen.
- **Beneficiaries** — replace the whole list at any time before a trigger.
  Shares must total 100%; the app validates this before you sign.
- **Settings** — change the check-in interval or allowed misses, manage the
  automation reserve (see below), or close an empty vault.
- **Activity** — every vault event with links to the block explorer.
- **Security** — see all wallets on this device, lock them, or remove one.

## If you stop checking in

Miss a check-in and the vault moves to Missed — check in any time to return
to Active with a fresh timer. Miss enough in a row and it becomes Eligible:
anyone (including Kinn's automated keeper) may then trigger inheritance. From
the trigger onward the vault is frozen and each asset is paid out per your
stored percentages. Failed payouts stay recorded and are retried; nothing is
ever silently lost.

## Costs

You pay gas for your own transactions (create, deposit, withdraw, check-in,
settings) — ordinary network fees, a few cents on Base. Inheritance execution
is paid from your vault's automation reserve, a small ETH balance you top up
in Settings so the keeper can pay gas for the trigger and distribution
transactions. The reserve is yours: withdraw it any time before a trigger.

## Security notes

- Your passphrase decrypts your key. Forget it and the wallet on that device
  is unusable — keep it somewhere safe, separate from the device.
- Your key locks automatically when the tab hides or closes. Unlock it with
  your passphrase on the Unlock screen.
- Wallets live per device. A wallet created on your laptop does not exist on
  your phone. Each device needs its own wallet (each can own one vault).
- Kinn's servers prepare your transactions but can never sign, move, or
  freeze anything. Every movement of funds requires your signature, verified
  by the contract itself.
- Always check the receiving address on MetaMask-style prompts if you use a
  fallback wallet, and confirm you are on the correct network (Base Sepolia
  during testnet) before signing.

## Troubleshooting

- "Unlock your Kinn wallet first" — your key is locked. Go to Unlock, enter
  your passphrase, and sign in again. Funding an address does not unlock it.
- "No vault yet" — the signed-in address has never created a vault. Create one.
- Transaction reverted — read the message shown: it comes from the contract
  (for example, allocations not totalling 100%, or acting on a frozen vault).
- Wrong network in a fallback wallet — switch to Base Sepolia and retry.
- Lost passphrase — the key cannot be recovered. If the vault still holds
  assets and you cannot sign, those assets cannot be moved by anyone,
  including Kinn. This is the price of true self-custody.
