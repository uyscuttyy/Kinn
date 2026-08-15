import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { WalletAuthService, InMemoryWalletAssociationRepository } from "../src/auth/WalletAuthService.js";
import { DeploymentRegistry } from "../src/deployments/DeploymentRegistry.js";

const BASE_CONTRACT = "0x1000000000000000000000000000000000000000";
const XLAYER_CONTRACT = "0x2000000000000000000000000000000000000000";

function fixture(nowValue = 1_000) {
  const deployments = new DeploymentRegistry([
    { key: "base-mainnet", chainId: 8453, contractAddress: BASE_CONTRACT },
    { key: "xlayer-testnet", chainId: 195, contractAddress: XLAYER_CONTRACT }
  ]);
  const associations = new InMemoryWalletAssociationRepository();
  let now = nowValue;
  const auth = new WalletAuthService(deployments, associations, () => now, 600, 3600);
  return { auth, associations, setNow: (value: number) => { now = value; } };
}

test("verifies an EIP-712 wallet challenge and creates a one-time session", async () => {
  const wallet = Wallet.createRandom();
  const { auth, associations } = fixture();
  const challenge = auth.createChallenge("base-mainnet", "telegram-123", wallet.address);
  const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.message);
  const session = await auth.verifyChallenge(challenge.message.nonce, signature);

  assert.equal(session.wallet, wallet.address);
  assert.equal(session.deploymentKey, "base-mainnet");
  assert.equal(auth.requireSession(session.token, "base-mainnet").telegramUserId, "telegram-123");
  assert.equal((await associations.find("base-mainnet", "telegram-123"))?.wallet, wallet.address);
  await assert.rejects(() => auth.verifyChallenge(challenge.message.nonce, signature), /already used/);
});

test("rejects a signature from a different wallet", async () => {
  const expected = Wallet.createRandom();
  const attacker = Wallet.createRandom();
  const { auth } = fixture();
  const challenge = auth.createChallenge("base-mainnet", "telegram-123", expected.address);
  const signature = await attacker.signTypedData(challenge.domain, challenge.types, challenge.message);
  await assert.rejects(() => auth.verifyChallenge(challenge.message.nonce, signature), /does not match/);
});

test("rejects expired challenges and deployment-mismatched sessions", async () => {
  const wallet = Wallet.createRandom();
  const { auth, setNow } = fixture();
  const challenge = auth.createChallenge("base-mainnet", "telegram-123", wallet.address);
  const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.message);
  setNow(1_601);
  await assert.rejects(() => auth.verifyChallenge(challenge.message.nonce, signature), /expired/);

  setNow(2_000);
  const fresh = auth.createChallenge("base-mainnet", "telegram-123", wallet.address);
  const freshSignature = await wallet.signTypedData(fresh.domain, fresh.types, fresh.message);
  const session = await auth.verifyChallenge(fresh.message.nonce, freshSignature);
  assert.throws(() => auth.requireSession(session.token, "xlayer-testnet"), /deployment mismatch/);
});

test("challenge domain binds signatures to chain and contract", async () => {
  const wallet = Wallet.createRandom();
  const { auth } = fixture();
  const challenge = auth.createChallenge("base-mainnet", "telegram-123", wallet.address);
  const wrongDomain = { ...challenge.domain, chainId: 195, verifyingContract: XLAYER_CONTRACT };
  const signature = await wallet.signTypedData(wrongDomain, challenge.types, challenge.message);
  await assert.rejects(() => auth.verifyChallenge(challenge.message.nonce, signature), /does not match/);
});
