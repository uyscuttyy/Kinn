/**
 * LocalEncryptedKeyManager (Phase 5).
 *
 * The initial first-party KeyManager backend:
 *  - Strong-random secp256k1 key generation (the 32-byte private key *is* the
 *    random value; no mnemonic is materialized).
 *  - Encrypted at rest with AES-256-GCM; the wrapping key is derived from the
 *    user passphrase with PBKDF2-HMAC-SHA-256 (210,000 iterations) via
 *    WebCrypto, and cached only as a *non-extractable* CryptoKey.
 *  - The raw private key exists only transiently in memory and is best-effort
 *    zeroized immediately after use.
 *  - Nothing is ever sent to the Kinn backend; nothing is logged.
 *
 * Storage contains only: version, salt, iv, ciphertext, public address,
 * timestamps, and a label. Compromise of the storage never yields a usable
 * key without the passphrase.
 */

import { ethers } from "ethers";
import {
  GeneratedKey,
  KeyHandle,
  KeyManager,
  KeyManagerError,
  SignableTransaction,
} from "./types.js";
import { createDefaultStorage, KeyValueStorage } from "./storage.js";

export const PBKDF2_ITERATIONS = 210_000;
const KEY_HANDLE_RANDOM_BYTES = 16;
const SALT_BYTES = 16;
const IV_BYTES = 12;

interface StoredRecord {
  v: 1;
  /** base64 PBKDF2 salt. */
  salt: string;
  /** base64 AES-GCM initialization vector. */
  iv: string;
  /** base64 AES-GCM ciphertext of the raw 32-byte private key. */
  ct: string;
  /** Checksummed address (public metadata, safe to store). */
  address: string;
  createdAt: number;
  label?: string;
}

export interface LocalEncryptedKeyManagerOptions {
  storage?: KeyValueStorage;
  /** Prefix for storage keys. Defaults to "kinn.key.". */
  storagePrefix?: string;
  /** Override PBKDF2 iteration count (tests only). */
  pbkdf2Iterations?: number;
  /** SubtleCrypto implementation. Defaults to the platform global. */
  subtle?: SubtleCrypto;
  /** Random source. Defaults to the platform global crypto. */
  randomBytes?: (length: number) => Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export class LocalEncryptedKeyManager implements KeyManager {
  private readonly storage: KeyValueStorage;
  private readonly prefix: string;
  private readonly iterations: number;
  private readonly subtle: SubtleCrypto;
  private readonly random: (length: number) => Uint8Array;
  /** Non-extractable wrapping keys cached while unlocked, per handle id. */
  private readonly unlocked = new Map<string, CryptoKey>();

  constructor(options: LocalEncryptedKeyManagerOptions = {}) {
    this.storage = options.storage ?? createDefaultStorage();
    this.prefix = options.storagePrefix ?? "kinn.key.";
    this.iterations = options.pbkdf2Iterations ?? PBKDF2_ITERATIONS;
    this.subtle = options.subtle ?? globalThis.crypto?.subtle;
    this.random =
      options.randomBytes ??
      ((length: number) => {
        const out = new Uint8Array(length);
        globalThis.crypto.getRandomValues(out);
        return out;
      });
  }

  /**
   * Create a new key wrapped under `passphrase`. The raw key is generated
   * locally, encrypted, and the plaintext buffer zeroized before returning.
   * The passphrase is required to be at least 8 characters.
   */
  async generate(passphrase: string, label?: string): Promise<GeneratedKey> {
    this.assertCrypto();
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      throw new KeyManagerError("INVALID_INPUT", "Passphrase must be a string of at least 8 characters.");
    }
    if (label !== undefined && (typeof label !== "string" || label.length > 100)) {
      throw new KeyManagerError("INVALID_INPUT", "Label must be a string of at most 100 characters.");
    }
    // A uniformly random 32-byte value is a valid secp256k1 private key.
    let raw = this.random(32);
    try {
      const wallet = new ethers.Wallet(ethers.hexlify(raw));
      const id = toBase64(this.random(KEY_HANDLE_RANDOM_BYTES)).replace(/[/+]/g, "_").replace(/=+$/, "");
      await this.encryptAndStore(id, raw, passphrase, wallet.address, label);
      return { id, createdAt: Math.floor(Date.now() / 1000), label, address: wallet.address };
    } finally {
      raw.fill(0);
      raw = new Uint8Array(0);
    }
  }

  async getAddress(id: string): Promise<string> {
    const record = await this.loadRecord(id);
    return record.address;
  }

  async signMessage(id: string, message: string): Promise<string> {
    const wallet = await this.walletFor(id);
    return wallet.signMessage(message);
  }

  async signTransaction(id: string, tx: SignableTransaction): Promise<string> {
    if (!tx || typeof tx !== "object") {
      throw new KeyManagerError("INVALID_INPUT", "A transaction object is required.");
    }
    const wallet = await this.walletFor(id);
    return wallet.signTransaction({ ...tx } as Parameters<ethers.Wallet["signTransaction"]>[0]);
  }

  async destroy(id: string): Promise<void> {
    this.lock(id);
    await this.storage.delete(this.storageKey(id));
  }

  async has(id: string): Promise<boolean> {
    return (await this.storage.get(this.storageKey(id))) !== null;
  }

  async list(): Promise<KeyHandle[]> {
    const keys = await this.storage.keys(this.prefix);
    const handles: KeyHandle[] = [];
    for (const key of keys) {
      const stored = await this.storage.get(key);
      if (!stored) continue;
      const record = this.parseRecord(key, stored);
      handles.push({ id: this.idOf(key), createdAt: record.createdAt, label: record.label });
    }
    return handles.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Derive the wrapping key from the passphrase and cache it (non-extractable)
   * until `lock`/`lockAll`/`destroy`. The raw private key is decrypted only
   * here and zeroized immediately after the ethers signing wallet is built.
   */
  async unlock(id: string, passphrase: string): Promise<void> {
    this.assertCrypto();
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      throw new KeyManagerError("INVALID_INPUT", "Passphrase must be a string of at least 8 characters.");
    }
    if (this.unlocked.has(id)) return;
    const record = await this.loadRecord(id);
    const wrappingKey = await this.deriveWrappingKey(passphrase, fromBase64(record.salt));
    let raw: Uint8Array | null = null;
    try {
      raw = await this.decryptPrivateBytes(wrappingKey, record);
      const wallet = new ethers.Wallet(ethers.hexlify(raw));
      if (wallet.address.toLowerCase() !== record.address.toLowerCase()) {
        // Ciphertext tampered with, or record corrupted: refuse to use it.
        throw new KeyManagerError("STORAGE_UNAVAILABLE", "Stored key material failed integrity verification.");
      }
      this.unlocked.set(id, wrappingKey);
    } catch (error) {
      if (error instanceof KeyManagerError) throw error;
      // AES-GCM authentication failure == wrong passphrase.
      throw new KeyManagerError("WRONG_PASSPHRASE", "The passphrase is incorrect.");
    } finally {
      if (raw) {
        raw.fill(0);
        raw = null;
      }
    }
  }

  /** Drop the cached wrapping key for one handle. */
  lock(id: string): void {
    this.unlocked.delete(id);
  }

  /** Drop all cached wrapping keys. */
  lockAll(): void {
    this.unlocked.clear();
  }

  /** Whether a handle currently holds a cached wrapping key. */
  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  private async walletFor(id: string): Promise<ethers.Wallet> {
    const wrappingKey = this.unlocked.get(id);
    if (!wrappingKey) throw new KeyManagerError("KEY_LOCKED", `Key ${id} is locked; call unlock() first.`);
    const record = await this.loadRecord(id);
    const raw = await this.decryptPrivateBytes(wrappingKey, record);
    try {
      return new ethers.Wallet(ethers.hexlify(raw));
    } finally {
      raw.fill(0);
    }
  }

  private async encryptAndStore(
    id: string,
    rawPrivateBytes: Uint8Array,
    passphrase: string,
    address: string,
    label?: string,
  ): Promise<void> {
    const salt = this.random(SALT_BYTES);
    const iv = this.random(IV_BYTES);
    const wrappingKey = await this.deriveWrappingKey(passphrase, salt);
    const ct = await this.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      wrappingKey,
      rawPrivateBytes as BufferSource,
    );
    const record: StoredRecord = {
      v: 1,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(ct)),
      address,
      createdAt: Math.floor(Date.now() / 1000),
      label,
    };
    await this.storage.set(this.storageKey(id), JSON.stringify(record));
  }

  private async deriveWrappingKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await this.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase) as BufferSource,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return this.subtle.deriveKey(
      { name: "PBKDF2", salt: salt as BufferSource, iterations: this.iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false, // non-extractable: the wrapping key can never be read out
      ["encrypt", "decrypt"],
    );
  }

  private async decryptPrivateBytes(wrappingKey: CryptoKey, record: StoredRecord): Promise<Uint8Array> {
    const plain = await this.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv) as BufferSource },
      wrappingKey,
      fromBase64(record.ct) as BufferSource,
    );
    const bytes = new Uint8Array(plain);
    if (bytes.length !== 32) {
      throw new KeyManagerError("STORAGE_UNAVAILABLE", "Stored key material has an unexpected length.");
    }
    return bytes;
  }

  private async loadRecord(id: string): Promise<StoredRecord> {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{20,32}$/.test(id)) {
      throw new KeyManagerError("KEY_NOT_FOUND", "Unknown key handle.");
    }
    const stored = await this.storage.get(this.storageKey(id));
    if (stored === null) throw new KeyManagerError("KEY_NOT_FOUND", `No key exists for handle ${id}.`);
    return this.parseRecord(id, stored);
  }

  private parseRecord(_id: string, stored: string): StoredRecord {
    try {
      const parsed = JSON.parse(stored) as StoredRecord;
      if (parsed?.v !== 1 || typeof parsed.ct !== "string" || typeof parsed.address !== "string") {
        throw new Error("shape");
      }
      return parsed;
    } catch {
      throw new KeyManagerError("STORAGE_UNAVAILABLE", "Stored key record is corrupt.");
    }
  }

  private storageKey(id: string): string {
    return this.prefix + id;
  }

  private idOf(storageKey: string): string {
    return storageKey.slice(this.prefix.length);
  }

  private assertCrypto(): void {
    if (
      !this.subtle ||
      typeof this.subtle.importKey !== "function" ||
      typeof this.subtle.deriveKey !== "function"
    ) {
      throw new KeyManagerError("CRYPTO_UNAVAILABLE", "WebCrypto (crypto.subtle) is required for key management.");
    }
  }
}

