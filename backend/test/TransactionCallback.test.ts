import assert from "node:assert/strict";
import test from "node:test";
import {
  createTransactionCallback, resolveChainEnvironment, verifyTransactionCallback
} from "../src/wallet/transactionCallback.js";

const transaction = {
  chainId: 1952,
  from: "0x8068FcfdCdbF559ECE244a01aC2E6B3DEf40613C",
  to: "0xa271CA6aB244cc965BA0eCf1Eb6f1b1d19C22eda",
  data: "0x1234"
};

test("valid transaction callback verifies", () => {
  const callback = createTransactionCallback("test-secret", "123", transaction, 1_000);
  assert.equal(verifyTransactionCallback("test-secret", callback, 1_100), true);
});

test("tampered transaction callback is rejected", () => {
  const callback = createTransactionCallback("test-secret", "123", transaction, 1_000);
  assert.equal(verifyTransactionCallback("test-secret", { ...callback, chatId: "456" }, 1_100), false);
});

test("expired transaction callback is rejected", () => {
  const callback = createTransactionCallback("test-secret", "123", transaction, 1_000);
  assert.equal(verifyTransactionCallback("test-secret", callback, callback.expiresAt + 1), false);
});

test("chain-specific environment value overrides the fallback", () => {
  const env = { KINN_RPC_URL: "fallback", KINN_RPC_URL_1952: "xlayer" };
  assert.equal(resolveChainEnvironment(env, "KINN_RPC_URL", 1952, "KINN_RPC_URL"), "xlayer");
  assert.equal(resolveChainEnvironment(env, "KINN_RPC_URL", 999, "KINN_RPC_URL"), "fallback");
});
