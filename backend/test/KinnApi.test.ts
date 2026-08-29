import assert from "node:assert/strict";
import test from "node:test";
import { KinnApi } from "../src/api/KinnApi.js";
import type { KinnContractService } from "../src/blockchain/KinnContractService.js";

const OWNER = "0x2000000000000000000000000000000000000000";
const prepared = {
  chainId: 84532,
  to: "0x1000000000000000000000000000000000000000",
  data: "0x1234",
  value: "0x0" as const
};

test("API prepares transactions but has no broadcast operation", async () => {
  const fake = {
    prepareCheckIn: (() => Promise.resolve(prepared)) as unknown as KinnContractService["prepareCheckIn"]
  } as unknown as KinnContractService;
  const api = new KinnApi(fake);
  assert.deepEqual(await api.prepareTransaction({ action: "check_in", owner: OWNER }), prepared);
  assert.equal("broadcast" in api, false);
  assert.equal("sign" in api, false);
});

test("API routes token approval through the contract service with the owner's instance", async () => {
  const fake = {
    prepareTokenApproval: (_owner: string, token: string, amount: bigint) =>
      Promise.resolve({ ...prepared, to: token, data: amount.toString() })
  } as unknown as KinnContractService;
  const api = new KinnApi(fake);
  const token = "0x3000000000000000000000000000000000000000";
  assert.deepEqual(await api.prepareTransaction({ action: "approve_token", owner: OWNER, token, amount: 500n }), {
    ...prepared, to: token, data: "500"
  });
});
