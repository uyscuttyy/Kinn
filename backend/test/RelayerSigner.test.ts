import assert from "node:assert/strict";
import test from "node:test";
import type { EthersSignerLike, RelayerSigner, RelayerTransaction } from "../src/automation/RelayerSigner.js";
import { EthersRelayerSigner, RemoteSigningServiceSigner } from "../src/automation/RelayerSigner.js";
import { ManagedRelayerSubmitter } from "../src/automation/ManagedRelayerSubmitter.js";
import { createRelayerSignerProvider } from "../src/automation/createRelayerSignerProvider.js";

const TX: RelayerTransaction = {
  to: "0x1000000000000000000000000000000000000000",
  data: "0x1234",
  value: "0x03e8"
};

const stubSigner = (chainId: bigint): EthersSignerLike => ({
  address: "0x2000000000000000000000000000000000000000",
  provider: {
    async getNetwork() { return { chainId }; },
    async waitForTransaction(hash: string) { return { blockNumber: 42, status: 1 }; }
  },
  async sendTransaction(transaction) {
    assert.equal(transaction.to, TX.to);
    assert.equal(transaction.data, TX.data);
    assert.equal(transaction.value, 1000n);
    return { hash: "0xabc" };
  }
});

test("the ethers-backed signer forwards the payload and guards the chain", async () => {
  const signer = new EthersRelayerSigner(stubSigner(84532n), 84532);
  assert.equal(signer.address, "0x2000000000000000000000000000000000000000");
  assert.equal(await signer.send(TX), "0xabc");
  const receipt = await signer.wait("0xabc");
  assert.deepEqual(receipt, { transactionHash: "0xabc", blockNumber: 42, success: true });

  const mismatched = new EthersRelayerSigner(stubSigner(1n), 84532);
  await assert.rejects(mismatched.send(TX), /chain ID mismatch/);
});

test("the ethers-backed signer surfaces no key material on its own surface", async () => {
  const signer = new EthersRelayerSigner(stubSigner(84532n), 84532);
  const serialized = JSON.stringify(
    Object.getOwnPropertyNames(signer).map((key) => (signer as never as Record<string, unknown>)[key])
  );
  assert.ok(!serialized.includes("privateKey"));
  assert.ok(!serialized.includes("mnemonic"));
});

test("the remote signing service posts the unsigned payload and parses results", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = calls.length === 1 ? { transactionHash: "0xhash" } : { blockNumber: 7, success: false };
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;

  const signer = new RemoteSigningServiceSigner(
    "0x3000000000000000000000000000000000000000", "https://signer.example", 84532, "token-1", fetchImpl
  );
  assert.equal(await signer.send(TX), "0xhash");
  assert.deepEqual(await signer.wait("0xhash"), { transactionHash: "0xhash", blockNumber: 7, success: false });

  assert.equal(calls[0]?.url, "https://signer.example/sign");
  const request = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(request, { to: TX.to, data: TX.data, value: TX.value, chainId: 84532 });
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, "Bearer token-1");
  assert.equal(calls[1]?.url, "https://signer.example/receipt/0xhash");
});

test("the remote signing service rejects HTTP failures and incomplete receipts", async () => {
  const failing = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
  const signer = new RemoteSigningServiceSigner(
    "0x3000000000000000000000000000000000000000", "https://signer.example", 84532, undefined, failing
  );
  await assert.rejects(signer.send(TX), /HTTP 502/);

  const incomplete = (async () => ({ ok: true, json: async () => ({ blockNumber: 7 }) })) as unknown as typeof fetch;
  const partial = new RemoteSigningServiceSigner(
    "0x3000000000000000000000000000000000000000", "https://signer.example", 84532, undefined, incomplete
  );
  await assert.rejects(partial.wait("0xabc"), /incomplete receipt/);
});

test("the submitter delegates entirely to the managed signer provider", async () => {
  const seen: string[] = [];
  const signer: RelayerSigner = {
    address: "0x2000000000000000000000000000000000000000",
    async send(transaction) {
      seen.push(`send:${transaction.to}:${transaction.value}`);
      return "0xhash";
    },
    async wait(hash) {
      seen.push(`wait:${hash}`);
      return { transactionHash: hash, blockNumber: 1, success: true };
    }
  };
  const submitter = new ManagedRelayerSubmitter({
    get: (key: string) => {
      assert.equal(key, "base-sepolia");
      return signer;
    }
  });
  assert.equal(
    await submitter.submit("base-sepolia", { chainId: 84532, to: TX.to, data: TX.data, value: "0x03e8" }),
    "0xhash"
  );
  assert.deepEqual(await submitter.wait("base-sepolia", "0xhash"), {
    transactionHash: "0xhash", blockNumber: 1, success: true
  });
  assert.deepEqual(seen, [`send:${TX.to}:0x03e8`, "wait:0xhash"]);
});

test("the factory selects the remote signing service when configured", () => {
  const info = createRelayerSignerProvider(
    { KINN_RELAYER_SIGNER_URL: "https://signer.example/", KINN_RELAYER_SIGNER_TOKEN: "t" },
    [{ key: "base-sepolia", chainId: 84532, rpcUrl: "https://rpc.example", contractAddress: "0x1000000000000000000000000000000000000000" }]
  );
  assert.equal(info.mode, "remote_signing_service");
  assert.ok(info.provider.get("base-sepolia") instanceof RemoteSigningServiceSigner);
  assert.equal(info.addresses.get("base-sepolia"), "managed");
  assert.throws(() => info.provider.get("unknown"), /No managed relayer signer/);
});

test("the factory keeps the legacy env fallback and rejects a missing configuration", () => {
  const key = "0x" + "11".repeat(32);
  const legacy = createRelayerSignerProvider(
    { KINN_RELAYER_PRIVATE_KEY: key },
    [{ key: "xlayer-testnet", chainId: 195, rpcUrl: "https://rpc.example", contractAddress: "0x1000000000000000000000000000000000000000" }]
  );
  assert.equal(legacy.mode, "legacy_env_key");
  assert.ok(legacy.provider.get("xlayer-testnet") instanceof EthersRelayerSigner);
  assert.match(legacy.addresses.get("xlayer-testnet") ?? "", /^0x[0-9a-fA-F]{40}$/);

  assert.throws(
    () => createRelayerSignerProvider(
      {},
      [{ key: "k", chainId: 1, rpcUrl: "u", contractAddress: "0x1000000000000000000000000000000000000000" }]
    ),
    /No managed relayer signer is configured/
  );
});