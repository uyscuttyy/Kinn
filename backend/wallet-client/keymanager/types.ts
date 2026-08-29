/**
 * Kinn KeyManager boundary (Phase 5).
 *
 * This module is the *only* key-management surface for the first-party Kinn
 * wallet. It exposes only key *handles*; raw private keys never leave the
 * manager, are never persisted in the clear, and are never sent to the Kinn
 * backend. Future backends (Passkey/WebAuthn, hardware signers, ERC-4337
 * smart accounts, session keys) must implement the same interface.
 */

/** Opaque reference to a key held by a KeyManager. Handles are not keys. */
export interface KeyHandle {
  /** Random, non-guessable identifier (rotation-safe). */
  readonly id: string;
  /** Creation time, epoch seconds. */
  readonly createdAt: number;
  /** Optional user-facing label (e.g. "Everyday wallet"). */
  readonly label?: string;
}

/** Serialized Ethereum transaction fields accepted for signing. */
export interface SignableTransaction {
  to?: string;
  from?: string;
  nonce?: number | string;
  gasLimit?: number | string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  data?: string;
  value?: string;
  chainId?: number;
  type?: number;
}

export interface GeneratedKey extends KeyHandle {
  /** Full handle record persisted metadata (never contains key material). */
  readonly address: string;
}

/**
 * The key-management boundary. Signing sits behind this interface so the
 * backend can evolve without touching wallet business logic.
 */
export interface KeyManager {
  /**
   * Create a new key. The passphrase wraps the key at rest (LocalEncrypted
   * backend); returns the handle + derived address.
   */
  generate(passphrase: string, label?: string): Promise<GeneratedKey>;

  /** Checksummed Ethereum address for a handle. */
  getAddress(id: string): Promise<string>;

  /** EIP-191 personal_sign of a message. Returns the 65-byte signature hex. */
  signMessage(id: string, message: string): Promise<string>;

  /** Sign a transaction. Returns the RLP-encoded signed transaction hex. */
  signTransaction(id: string, tx: SignableTransaction): Promise<string>;

  /** Irrecoverably destroy the key (encrypted material + unlock state). */
  destroy(id: string): Promise<void>;

  /** Whether a key with this handle id exists. */
  has(id: string): Promise<boolean>;

  /** All handles known to this manager (metadata only, never key material). */
  list(): Promise<KeyHandle[]>;
}

/** Error codes surfaced by KeyManager implementations. */
export type KeyManagerErrorCode =
  | "KEY_NOT_FOUND"
  | "KEY_LOCKED"
  | "WRONG_PASSPHRASE"
  | "STORAGE_UNAVAILABLE"
  | "INVALID_INPUT"
  | "CRYPTO_UNAVAILABLE";

/** Structured error thrown by KeyManager implementations. Never carries key material. */
export class KeyManagerError extends Error {
  readonly code: KeyManagerErrorCode;

  constructor(code: KeyManagerErrorCode, message: string) {
    super(message);
    this.name = "KeyManagerError";
    this.code = code;
  }
}
