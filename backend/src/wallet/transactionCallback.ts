import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TransactionCallback {
  chatId: string;
  chainId: number;
  from: string;
  to: string;
  dataHash: string;
  expiresAt: number;
  signature: string;
}

export function createTransactionCallback(
  secret: string,
  chatId: string,
  transaction: { chainId: number; from: string; to: string; data: string },
  now = Math.floor(Date.now() / 1000)
): TransactionCallback {
  const unsigned = {
    chatId,
    chainId: transaction.chainId,
    from: transaction.from.toLowerCase(),
    to: transaction.to.toLowerCase(),
    dataHash: hashData(transaction.data),
    expiresAt: now + 30 * 60
  };
  return { ...unsigned, signature: sign(secret, unsigned) };
}

export function verifyTransactionCallback(secret: string, callback: TransactionCallback, now = Math.floor(Date.now() / 1000)) {
  if (callback.expiresAt < now) return false;
  const expected = sign(secret, callback);
  const provided = Buffer.from(callback.signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return provided.length === expectedBytes.length && timingSafeEqual(provided, expectedBytes);
}

export function hashData(data: string) {
  return createHash("sha256").update(data.toLowerCase()).digest("hex");
}

export function resolveChainEnvironment(
  env: NodeJS.ProcessEnv,
  prefix: string,
  chainId: number,
  fallbackKey?: string
) {
  return env[`${prefix}_${chainId}`] ?? (fallbackKey ? env[fallbackKey] : undefined);
}

function sign(secret: string, value: Omit<TransactionCallback, "signature">) {
  return createHmac("sha256", secret).update([
    value.chatId,
    value.chainId,
    value.from.toLowerCase(),
    value.to.toLowerCase(),
    value.dataHash,
    value.expiresAt
  ].join(":"), "utf8").digest("hex");
}
