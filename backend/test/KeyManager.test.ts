import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { ethers } from "ethers";
import { LocalEncryptedKeyManager } from "../wallet-client/keymanager/LocalEncryptedKeyManager.js";
import { MemoryStorage } from "../wallet-client/keymanager/storage.js";
import { KeyManagerError } from "../wallet-client/keymanager/types.js";

/** PBKDF2 at 210k iterations is too slow for a unit suite; tests use 1000. */
const FAST_ITERATIONS = 1000;
const PASSPHRASE = "correct horse battery staple";

const makeManager = () =>
  new LocalEncryptedKeyManager({ storage: new MemoryStorage(), pbkdf2Iterations: FAST_ITERATIONS });

describe("LocalEncryptedKeyManager", () => {
  test("generate returns a handle with the correct derived address", async () => {
    const manager = makeManager();
    const generated = await manager.generate(PASSPHRASE, "Everyday wallet");
    assert.match(generated.id, /^[A-Za-z0-9_-]{20,32}$/);
    assert.equal(generated.label, "Everyday wallet");
    assert.match(generated.address, /^0x[0-9a-fA-F]{40}$/);
    // The stored record's address must match the wrapped key's address.
    assert.equal(await manager.getAddress(generated.id), generated.address);
    assert.equal(await manager.has(generated.id), true);
  });

  test("generate rejects short passphrases and never stores on failure", async () => {
    const manager = makeManager();
    await assert.rejects(manager.generate("short"), (error: KeyManagerError) => error.code === "INVALID_INPUT");
    assert.deepEqual(await manager.list(), []);
  });

  test("storage never contains raw key material or the passphrase", async () => {
    const storage = new MemoryStorage();
    const manager = new LocalEncryptedKeyManager({ storage, pbkdf2Iterations: FAST_ITERATIONS });
    const generated = await manager.generate(PASSPHRASE);
    const stored = (await storage.get(`kinn.key.${generated.id}`))!;
    const record = JSON.parse(stored) as { v: number; salt: string; iv: string; ct: string; address: string };
    assert.equal(record.v, 1);
    assert.match(record.address, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(!stored.includes(PASSPHRASE));
    for (const field of [record.salt, record.iv, record.ct]) {
      assert.ok(field.length > 0);
    }
  });

  test("unlock with the wrong passphrase fails and never caches", async () => {
    const manager = makeManager();
    const generated = await manager.generate(PASSPHRASE);
    await assert.rejects(
      manager.unlock(generated.id, "wrong passphrase"),
      (error: KeyManagerError) => error.code === "WRONG_PASSPHRASE",
    );
    assert.equal(manager.isUnlocked(generated.id), false);
    await assert.rejects(
      manager.signMessage(generated.id, "hello"),
      (error: KeyManagerError) => error.code === "KEY_LOCKED",
    );
  });

  test("signMessage produces an EIP-191 signature recoverable to the address", async () => {
    const manager = makeManager();
    const generated = await manager.generate(PASSPHRASE);
    await manager.unlock(generated.id, PASSPHRASE);
    const message = "Kinn session nonce: 42";
    const signature = await manager.signMessage(generated.id, message);
    assert.equal(ethers.verifyMessage(message, signature), generated.address);
  });

  test("signTransaction produces a valid signed transaction", async () => {
    const manager = makeManager();
    const generated = await manager.generate(PASSPHRASE);
    await manager.unlock(generated.id, PASSPHRASE);
    const serialized = await manager.signTransaction(generated.id, {
      to: "0x1111111111111111111111111111111111111111",
      value: ethers.parseEther("0.01").toString(),
      nonce: 0,
      gasLimit: 21000,
      chainId: 84532,
    });
    const parsed = ethers.Transaction.from(serialized);
    assert.equal(parsed.from?.toLowerCase(), generated.address.toLowerCase());
    assert.equal(parsed.to?.toLowerCase(), "0x1111111111111111111111111111111111111111");
    assert.equal(parsed.chainId, 84532n);
    assert.equal(parsed.value, ethers.parseEther("0.01"));
  });

  test("signing is blocked while locked, works after unlock, blocked again after lock", async () => {
    const manager = makeManager();
    const generated = await manager.generate(PASSPHRASE);
    await assert.rejects(
      manager.signMessage(generated.id, "x"),
      (error: KeyManagerError) => error.code === "KEY_LOCKED",
    );
    await manager.unlock(generated.id, PASSPHRASE);
    assert.equal(manager.isUnlocked(generated.id), true);
    await manager.signMessage(generated.id, "x"); // works
    manager.lock(generated.id);
    await assert.rejects(
      manager.signMessage(generated.id, "x"),
      (error: KeyManagerError) => error.code === "KEY_LOCKED",
    );
    // Re-unlock still works after locking (key material survived).
    await manager.unlock(generated.id, PASSPHRASE);
    await manager.signMessage(generated.id, "y");
  });

  test("keys survive manager restarts through shared storage", async () => {
    const storage = new MemoryStorage();
    const first = new LocalEncryptedKeyManager({ storage, pbkdf2Iterations: FAST_ITERATIONS });
    const generated = await first.generate(PASSPHRASE);
    first.lockAll();

    const second = new LocalEncryptedKeyManager({ storage, pbkdf2Iterations: FAST_ITERATIONS });
    assert.equal(await second.has(generated.id), true);
    await second.unlock(generated.id, PASSPHRASE);
    const signature = await second.signMessage(generated.id, "after restart");
    assert.equal(ethers.verifyMessage("after restart", signature), generated.address);
  });

  test("destroy irrecoverably removes the key and lock state", async () => {
    const storage = new MemoryStorage();
    const manager = new LocalEncryptedKeyManager({ storage, pbkdf2Iterations: FAST_ITERATIONS });
    const generated = await manager.generate(PASSPHRASE);
    await manager.unlock(generated.id, PASSPHRASE);
    await manager.destroy(generated.id);
    assert.equal(await manager.has(generated.id), false);
    assert.equal(manager.isUnlocked(generated.id), false);
    await assert.rejects(
      manager.getAddress(generated.id),
      (error: KeyManagerError) => error.code === "KEY_NOT_FOUND",
    );
    await manager.unlock(generated.id, PASSPHRASE).then(
      () => assert.fail("unlock must fail after destroy"),
      (error: KeyManagerError) => assert.equal(error.code, "KEY_NOT_FOUND"),
    );
  });

  test("list returns handles only, sorted by creation time, without key material", async () => {
    const manager = makeManager();
    const a = await manager.generate(PASSPHRASE, "first");
    const b = await manager.generate(PASSPHRASE, "second");
    const handles = await manager.list();
    assert.deepEqual(
      handles.map((h) => h.id),
      [a.id, b.id],
    );
    for (const handle of handles) {
      const serialized = JSON.stringify(handle);
      assert.ok(!serialized.includes(PASSPHRASE));
      assert.ok(!serialized.includes("ct") && !serialized.includes("salt"));
    }
  });

  test("unknown or malformed handles surface KEY_NOT_FOUND, not crashes", async () => {
    const manager = makeManager();
    await assert.rejects(
      manager.getAddress("does-not-exist-at-all"),
      (error: KeyManagerError) => error.code === "KEY_NOT_FOUND",
    );
    await assert.rejects(
      manager.getAddress("../traversal"),
      (error: KeyManagerError) => error.code === "KEY_NOT_FOUND",
    );
  });
});
