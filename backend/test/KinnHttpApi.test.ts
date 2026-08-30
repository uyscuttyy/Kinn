import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet, type HDNodeWallet } from "ethers";
import { KinnHttpApi } from "../src/web/KinnHttpApi.js";
import { DeploymentRegistry } from "../src/deployments/DeploymentRegistry.js";
import { WalletAuthService, InMemoryWalletAssociationRepository } from "../src/auth/WalletAuthService.js";
import { KinnApi } from "../src/api/KinnApi.js";
import { AuthenticatedKinnApi } from "../src/api/AuthenticatedKinnApi.js";
import { KinnContractService } from "../src/blockchain/KinnContractService.js";
import type { RpcClient } from "../src/blockchain/RpcClient.js";
import { factoryAbi } from "../src/contracts/factoryAbi.js";
import { ETH_SENTINEL, vaultAbi } from "../src/contracts/vaultAbi.js";
import type { ChainLog } from "../src/types.js";

const NETWORK = "base-sepolia";
const FACTORY = "0x1000000000000000000000000000000000000000";
const INSTANCE = "0x5000000000000000000000000000000000000000";
const OWNER = "0x2000000000000000000000000000000000000000";
const ALICE = "0x4000000000000000000000000000000000000000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RPC_URL = "https://rpc.example";

const networkConfig = { key: NETWORK, chainId: 84532, rpcUrl: RPC_URL, contractAddress: FACTORY };

class MockRpc implements RpcClient {
  readonly factory = new Interface(factoryAbi);
  readonly instance = new Interface(vaultAbi);
  readonly erc20 = new Interface(["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)"]);
  readonly owner = OWNER;

  async call(to: string, data: string): Promise<string> {
    const lower = to.toLowerCase();
    if (lower === USDC.toLowerCase()) {
      if (data.slice(0, 10) === this.erc20.getFunction("decimals")?.selector) return this.erc20.encodeFunctionResult("decimals", [6]);
      if (data.slice(0, 10) === this.erc20.getFunction("symbol")?.selector) return this.erc20.encodeFunctionResult("symbol", ["USDC"]);
      if (data.slice(0, 10) === this.erc20.getFunction("balanceOf")?.selector) return this.erc20.encodeFunctionResult("balanceOf", [7_770_000n]);
      throw new Error("Unexpected ERC-20 call");
    }
    if (lower === FACTORY.toLowerCase()) {
      const f = this.factory.getFunction(data.slice(0, 10));
      assert(f);
      if (f.name === "vaultOf") {
        // Map any queried owner to INSTANCE so both read and owner-write flows resolve.
        return this.factory.encodeFunctionResult(f, [INSTANCE]);
      }
      if (f.name === "isVault") {
        const [candidate] = this.factory.decodeFunctionData(f, data);
        return this.factory.encodeFunctionResult(f, [candidate.toLowerCase() === INSTANCE.toLowerCase()]);
      }
      throw new Error(`Unexpected factory call ${f.name}`);
    }
    const g = this.instance.getFunction(data.slice(0, 10));
    assert(g, `instance call ${data.slice(0, 10)}`);
    switch (g.name) {
      case "owner": return this.instance.encodeFunctionResult(g, [this.owner]);
      case "factory": return this.instance.encodeFunctionResult(g, [FACTORY]);
      case "closed": return this.instance.encodeFunctionResult(g, [false]);
      case "inheritanceTriggered": return this.instance.encodeFunctionResult(g, [false]);
      case "lastCheckIn": return this.instance.encodeFunctionResult(g, [1000n]);
      case "checkInInterval": return this.instance.encodeFunctionResult(g, [604800n]);
      case "maxMissedCheckIns": return this.instance.encodeFunctionResult(g, [3]);
      case "automationReserve": return this.instance.encodeFunctionResult(g, [123n]);
      case "state": return this.instance.encodeFunctionResult(g, [0]);
      case "inheritanceEligible": return this.instance.encodeFunctionResult(g, [false]);
      case "nextExpectedCheckIn": return this.instance.encodeFunctionResult(g, [605800n]);
      case "missedCheckIns": return this.instance.encodeFunctionResult(g, [1]);
      case "getBeneficiaries": return this.instance.encodeFunctionResult(g, [[[ALICE, 10_000]]]);
      case "getTrackedAssets": return this.instance.encodeFunctionResult(g, [[ETH_SENTINEL, USDC]]);
      case "protectedAssetBalance": return this.instance.encodeFunctionResult(g, [5000n]);
      default: throw new Error(`Unexpected instance call ${g.name}`);
    }
  }

  async getBalance(_address: string): Promise<bigint> { return 1500000000000000000n; }
  async getLogs(): Promise<ChainLog[]> { return []; }
  async getBlockNumber(): Promise<number> { return 0; }
}

async function makeHarness() {
  const rpc = new MockRpc();
  const contract = new KinnContractService(rpc, FACTORY, 84532);
  const api = new KinnApi(contract);
  const apis = new Map([[NETWORK, api]]);
  const deployments = new DeploymentRegistry([{ key: NETWORK, chainId: 84532, contractAddress: FACTORY }]);
  const auth = new WalletAuthService(deployments, new InMemoryWalletAssociationRepository());
  const authenticatedApi = new AuthenticatedKinnApi(apis, auth);
  return {
    http: new KinnHttpApi({
      deployments, auth, apis, authenticatedApi,
      rpc: new Map([[NETWORK, rpc]]),
      networkConfigs: new Map([[NETWORK, networkConfig]]),
      env: { KINN_BASE_SEPOLIA_USDC: USDC }
    }),
    auth,
    wallet: Wallet.createRandom()
  };
}

async function createSession(auth: WalletAuthService, wallet: HDNodeWallet) {
  const challenge = auth.createChallenge(NETWORK, wallet.address, wallet.address);
  const signature = await wallet.signTypedData(challenge.domain, challenge.types, challenge.message);
  const session = await auth.verifyChallenge(challenge.message.nonce, signature);
  return { token: session.token, wallet: wallet.address };
}
test("GET /assets returns the supported asset set for a network", async () => {
  const { http } = await makeHarness();
  const response = await http.handle("GET", `/api/v1/${NETWORK}/assets`, {}, "");
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body) as { assets: { symbol: string; native: boolean }[] };
  assert.deepEqual(data.assets.map((a) => a.symbol).sort(), ["ETH", "USDC"]);
});

test("auth challenge + verify issues a session usable on wallet endpoints", async () => {
  const { http, auth, wallet } = await makeHarness();
  const challengeRes = await http.handle("POST", `/api/v1/${NETWORK}/auth/challenge`, {}, JSON.stringify({ wallet: wallet.address, networkKey: NETWORK }));
  assert.equal(challengeRes.status, 200);
  const { token } = await createSession(auth, wallet);
  const walletRes = await http.handle("GET", `/api/v1/${NETWORK}/wallet`, { authorization: `Bearer ${token}` }, "");
  assert.equal(walletRes.status, 200);
  const data = JSON.parse(walletRes.body) as { wallet: string };
  assert.equal(data.wallet.toLowerCase(), wallet.address.toLowerCase());
});

test("wallet endpoints require a session token", async () => {
  const { http } = await makeHarness();
  const response = await http.handle("GET", `/api/v1/${NETWORK}/wallet`, {}, "");
  assert.equal(response.status, 401);
});

test("/wallet/balances returns live ETH and USDC balances", async () => {
  const { http, auth, wallet } = await makeHarness();
  const { token } = await createSession(auth, wallet);
  const response = await http.handle("GET", `/api/v1/${NETWORK}/wallet/balances`, { authorization: `Bearer ${token}` }, "");
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body) as { balances: { symbol: string; balance: string }[] };
  const eth = data.balances.find((b) => b.symbol === "ETH");
  const usdc = data.balances.find((b) => b.symbol === "USDC");
  assert.equal(eth?.balance, "1.5");
  assert.equal(usdc?.balance, "7.77");
});

test("vault status is read from the factory-resolved instance", async () => {
  const { http } = await makeHarness();
  const response = await http.handle("GET", `/api/v1/${NETWORK}/vaults/${OWNER}/status`, {}, "");
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body) as { status: { owner: string; active: boolean; balances: Record<string, string> } };
  assert.equal(data.status.owner.toLowerCase(), OWNER.toLowerCase());
  assert.equal(data.status.active, true);
});

test("owner writes prepare unsigned transactions bound to the verified session owner", async () => {
  const { http, auth, wallet } = await makeHarness();
  const { token } = await createSession(auth, wallet);
  // The session owner (wallet) has a vault via the mock's vaultOf(owner) -> INSTANCE resolution.
  const response = await http.handle("POST", `/api/v1/${NETWORK}/vaults/${wallet.address.toLowerCase()}/close`, { authorization: `Bearer ${token}` }, "");
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body) as { prepared: { to: string; data: string; from: string } };
  assert.equal(data.prepared.from.toLowerCase(), wallet.address.toLowerCase());
  assert.equal(data.prepared.to, INSTANCE);
});

test("POST /transactions/prepare returns an unsigned transaction", async () => {
  const { http } = await makeHarness();
  const response = await http.handle(
    "POST",
    `/api/v1/${NETWORK}/transactions/prepare`,
    {},
    JSON.stringify({ to: OWNER, data: "0x1234", value: "1000000000000000" })
  );
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body) as { prepared: { to: string; data: string; value: string } };
  assert.equal(data.prepared.data, "0x1234");
});

test("unknown network and protected sub-routes surface structured 4xx", async () => {
  const { http } = await makeHarness();
  const missing = await http.handle("GET", "/api/v1/nope/assets", {}, "");
  assert.equal(missing.status, 404);
  // The wallet namespace is session-gated: auth is checked before route existence.
  const gated = await http.handle("GET", `/api/v1/${NETWORK}/wallet/nope`, {}, "");
  assert.equal(gated.status, 401);
});
