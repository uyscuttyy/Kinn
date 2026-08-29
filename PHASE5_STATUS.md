# Kinn — Phase 5 Status Note

Status: COMPLETE · 2026-08-29

Phase 5 delivered the **first-party wallet key infrastructure**: the `KeyManager`
boundary and its initial `LocalEncryptedKeyManager` backend, per
`ARCHITECTURE.md` §3. Kinn becomes the wallet; no MetaMask dependency is
required for signing, and the backend still has **no private-key path**.

## What was built (backend/wallet-client/keymanager/)

- `types.ts` — the boundary. `KeyHandle` (opaque id + createdAt + optional
  label), `SignableTransaction`, `GeneratedKey`, and the `KeyManager`
  interface: `generate(passphrase, label?)`, `getAddress(id)`,
  `signMessage(id, message)` (EIP-191), `signTransaction(id, tx)`,
  `destroy(id)`, `has(id)`, `list()`. `KeyManagerError` carries a structured
  code (`KEY_NOT_FOUND`, `KEY_LOCKED`, `WRONG_PASSPHRASE`, `INVALID_INPUT`,
  `STORAGE_UNAVAILABLE`, `CRYPTO_UNAVAILABLE`) and never key material.
  Future backends (Passkey/WebAuthn, hardware signers, ERC-4337, session
  keys) implement the same interface.
- `storage.ts` — pluggable `KeyValueStorage` (get/set/delete/keys(prefix)):
  `MemoryStorage` (tests), `BrowserLocalStorage` (browser), and
  `createDefaultStorage()` which never throws. Only ciphertext + public
  metadata is ever written.
- `LocalEncryptedKeyManager.ts` — the initial backend:
  - Strong-random secp256k1 keygen (the 32-byte random value *is* the key; no
    mnemonic is materialized). Handle ids are random 128-bit unpadded
    base64url values, validated on every lookup.
  - Encrypted at rest: AES-256-GCM with a wrapping key derived from the user
    passphrase via PBKDF2-HMAC-SHA-256, 210,000 iterations (tests override to
    1000). The wrapping key is imported/derived **non-extractable**, so it can
    never be read out of WebCrypto.
  - Lock/unlock model: `unlock(id, passphrase)` derives and caches the
    wrapping key; `lock`/`lockAll` drop it. All sign paths throw
    `KEY_LOCKED` without a cached wrapping key. The raw private key exists
    only transiently during unlock/sign and is **zeroized** in `finally`
    blocks; unlock also re-derives the address and refuses a record whose
    ciphertext does not reproduce the stored address (tamper check).
  - Storage record: `{v, salt, iv, ct, address, createdAt, label}` — no raw
    key, no passphrase, ever. Nothing is sent to the Kinn backend; nothing
    is logged.

## Tests (backend/test/KeyManager.test.ts — 11 tests, all passing)

Address round-trip vs the stored record; short-passphrase rejection; storage
contains no raw key material or passphrase; wrong-passphrase →
`WRONG_PASSPHRASE` and no caching; EIP-191 `signMessage` recovered to the
address via `ethers.verifyMessage`; `signTransaction` parses back to the same
`from`/`to`/`value`/`chainId`; lock/unlock/lock gating; key survival across
manager restarts through shared storage; `destroy` irrecoverability; handle
`list()` metadata-only and creation-ordered; `KEY_NOT_FOUND` on unknown or
path-traversal handles.

## Build status

- `tsc -p backend/tsconfig.json` → OK (keymanager dir added to `include`).
- `npm run build:backend` → OK. Full backend test suite → OK.

## Boundaries preserved

- The backend (`backend/src/`) was **not modified** — it still has no private
  key ingestion and only prepares unsigned transactions. The KeyManager lives
  entirely on the wallet/browser side and is bundled by the existing
  `esbuild` wallet-client pipeline when imported.
- `.env` was not read or used by any new code.

## Wired next (Phase 6)

- Consume `KeyManager` in the signing page for first-party signing (keygen,
  passphrase unlock, sign the prepared unsigned `PreparedTransaction` from
  the API, broadcast) alongside the existing MetaMask/WalletConnect paths.
- Session-scoped unlock UX (auto-`lockAll` on idle/tab close).

## Security note

`.env` still contains historical private keys, a Telegram bot token, and an
OpenAI key from the pre-Phase-3 X Layer testnet work. Per
`PROJECT_HANDOFF.md`, treat these as compromised and rotate them.
