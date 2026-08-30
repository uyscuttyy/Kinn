import { getAddress, formatUnits, parseUnits } from "ethers";
import type { KinnApi } from "../api/KinnApi.js";
import type { AuthenticatedKinnApi, OwnerPrepareAction } from "../api/AuthenticatedKinnApi.js";
import type { WalletAuthService, WalletSession } from "../auth/WalletAuthService.js";
import { DeploymentRegistry } from "../deployments/DeploymentRegistry.js";
import type { RpcClient } from "../blockchain/RpcClient.js";
import type { NetworkConfig } from "../deployments/loadNetworkConfigs.js";
import type { VaultStatus } from "../types.js";
import { ApiError, parseJsonBody, requiredString, optionalString } from "./json.js";
import { supportedAssets, rawBalanceOf, type SupportedAsset } from "./supportedAssets.js";

/** BigInts are serialized as decimal strings per API.md. */
type Json = Record<string, unknown>;

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface KinnHttpApiDependencies {
  deployments: DeploymentRegistry;
  auth: WalletAuthService;
  apis: ReadonlyMap<string, KinnApi>;
  authenticatedApi: AuthenticatedKinnApi;
  rpc: ReadonlyMap<string, RpcClient>;
  networkConfigs: ReadonlyMap<string, NetworkConfig>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Stateless request --> response router for the Kinn Web-App REST API
 * (API.md). Every write returns an UNSIGNED `PreparedTransaction` (or the
 * result of preparing one) for the wallet to sign with the first-party
 * KeyManager; this transport never signs or broadcasts. 4xx carries a stable
 * error code; 5xx a structured `{ error }`.
 *
 * Mounted at `/api/v1/:networkKey/...`.
 */
export class KinnHttpApi {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly deps: KinnHttpApiDependencies) {
    this.env = deps.env ?? process.env;
  }

  /** Route a raw HTTP API call. `pathname` includes the full API path. */
  async handle(method: string, pathname: string, headers: Record<string, string>, rawBody: string): Promise<ApiResponse> {
    try {
      const segments = pathname.split("/").filter(Boolean); // e.g. api,v1,<networkKey>,...
      if (segments.length < 3 || segments[0] !== "api" || segments[1] !== "v1") {
        throw new ApiError(404, "NOT_FOUND", "Unknown route.");
      }
      const networkKey = segments[2]!;
      const rest = segments.slice(3).join("/");
      const body = await parseJsonBody(rawBody);
      const output = await this.dispatch(method, networkKey, rest, headers, body);
      return this.json(output.data, output.status);
    } catch (error) {
      if (error instanceof ApiError) {
        return this.json({ error: error.code, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "Internal server error";
      return this.json({ error: "INTERNAL", message }, 500);
    }
  }

  private async dispatch(
    method: string,
    networkKey: string,
    rest: string,
    headers: Record<string, string>,
    body: Json
  ): Promise<{ status: number; data: Json }> {
    return this.dispatchRoute(method, networkKey, rest, headers, body);
  }

  // ---- Response helpers ---------------------------------------------------

  private json(data: Json, status = 200): ApiResponse {
    return {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    };
  }

  private bearer(headers: Record<string, string>): string | undefined {
    const header = headers.authorization ?? headers["authorization"];
    if (!header) return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match?.[1];
  }

  private requireSession(headers: Record<string, string>, networkKey?: string): WalletSession {
    const token = this.bearer(headers);
    if (!token) throw new ApiError(401, "UNAUTHORIZED", "A Bearer session token is required.");
    try {
      const session = this.deps.auth.requireSession(token, networkKey);
      return { token, ...session };
    } catch (error) {
      throw new ApiError(401, "UNAUTHORIZED", error instanceof Error ? error.message : "Invalid session.");
    }
  }

  private network(networkKey: string): NetworkConfig {
    const config = this.deps.networkConfigs.get(networkKey);
    if (!config) throw new ApiError(404, "UNKNOWN_NETWORK", `Unknown network: ${networkKey}`);
    return config;
  }

  private api(networkKey: string): KinnApi {
    const api = this.deps.apis.get(networkKey);
    if (!api) throw new ApiError(404, "UNKNOWN_NETWORK", `No API for network: ${networkKey}`);
    return api;
  }

  private rpc(networkKey: string): RpcClient {
    const rpc = this.deps.rpc.get(networkKey);
    if (!rpc) throw new ApiError(404, "UNKNOWN_NETWORK", `No RPC for network: ${networkKey}`);
    return rpc;
  }

  async dispatchRoute(
    method: string,
    networkKey: string,
    rest: string,
    headers: Record<string, string>,
    body: Json
  ): Promise<{ status: number; data: Json }> {
    const [segment, ...tail] = rest.split("/");

    if (segment === "auth" && tail.length >= 1) {
      return this.handleAuth(method, tail.join("/"), headers, body);
    }

    if (rest === "assets" && method === "GET") {
      const config = this.network(networkKey);
      return { status: 200, data: { assets: supportedAssets(config, this.env) } };
    }

    if (segment === "wallet") {
      this.requireSession(headers, networkKey);
      return this.handleWallet(method, tail.join("/"), networkKey, body, headers);
    }

    if (segment === "vaults") {
      return this.handleVaults(method, networkKey, tail, headers, body);
    }

    if (segment === "transactions") {
      return this.handleTransactions(method, networkKey, tail, body);
    }

    throw new ApiError(404, "NOT_FOUND", "Unknown endpoint.");
  }

  private async handleAuth(method: string, rest: string, headers: Record<string, string>, body: Json) {
    if (rest === "challenge" && method === "POST") {
      const wallet = requiredString(body.wallet, "wallet");
      const user = optionalString(body.user, "user");
      const deploymentKey = optionalString(body.networkKey, "networkKey");
      if (!deploymentKey) throw new ApiError(400, "INVALID_INPUT", "networkKey is required to issue a challenge.");
      this.network(deploymentKey);
      const challenge = this.deps.auth.createChallenge(deploymentKey, user ?? getAddress(wallet), wallet);
      return { status: 200, data: { challenge } };
    }
    if (rest === "verify" && method === "POST") {
      const nonce = requiredString(body.nonce, "nonce");
      const signature = requiredString(body.signature, "signature");
      const session = await this.deps.auth.verifyChallenge(nonce, signature);
      return { status: 200, data: { token: session.token, expiresAt: session.expiresAt } };
    }
    if (rest === "session" && method === "POST") {
      const token = requiredString(body.token, "token");
      const session = this.deps.auth.requireSession(token);
      return {
        status: 200,
        data: { deploymentKey: session.deploymentKey, user: session.telegramUserId, wallet: session.wallet, expiresAt: session.expiresAt }
      };
    }
    if (rest === "logout" && method === "POST") {
      requiredString(body.token, "token");
      return { status: 200, data: { ok: true } };
    }
    throw new ApiError(404, "NOT_FOUND", "Unknown auth endpoint.");
  }

  private async handleWallet(method: string, rest: string, networkKey: string, body: Json, headers: Record<string, string>) {
    const session = this.requireSession(headers, networkKey);
    void body;
    if (rest === "" && method === "GET") {
      return { status: 200, data: { wallet: session.wallet, deploymentKey: networkKey, sessionIssuedAt: session.expiresAt } };
    }
    if (rest === "address" && method === "GET") {
      return { status: 200, data: { address: session.wallet } };
    }
    if (rest === "balances" && method === "GET") {
      const assets = supportedAssets(this.network(networkKey), this.env);
      const balances: Json[] = [];
      for (const asset of assets) {
        const raw = await rawBalanceOf(this.rpc(networkKey), asset, session.wallet);
        balances.push({ symbol: asset.symbol, address: asset.address, decimals: asset.decimals, native: asset.native, rawBalance: raw.toString(), balance: formatUnits(raw, asset.decimals) });
      }
      return { status: 200, data: { balances } };
    }
    if (rest === "transactions" && method === "GET") {
      return { status: 200, data: { transactions: [] } };
    }
    if (rest === "send" && method === "POST") {
      const to = requiredString(body.to, "to");
      const amount = parseUnits(requiredString(body.amount, "amount"), 18);
      return { status: 200, data: { prepared: this.nativeSend(networkKey, session.wallet, to, amount) } };
    }
    throw new ApiError(404, "NOT_FOUND", "Unknown wallet endpoint.");
  }

  private nativeSend(networkKey: string, from: string, to: string, amount: bigint) {
    return { chainId: this.network(networkKey).chainId, to: getAddress(to), data: "0x", value: amount.toString(), from };
  }
  private async handleVaults(method: string, networkKey: string, tail: string[], headers: Record<string, string>, body: Json) {
    const api = this.api(networkKey);

    if (tail.length === 0 && method === "POST") {
      const session = this.requireSession(headers, networkKey);
      const interval = BigInt(requiredString(body.interval, "interval"));
      const maxMisses = Number(body.maxMisses);
      const { accounts, allocationsBps } = parseBeneficiaries(body.beneficiaries);
      const action: OwnerPrepareAction = { action: "create_vault", interval, maxMisses, accounts, allocationsBps };
      const prepared = await this.deps.authenticatedApi.prepareOwnerTransaction(session.token, networkKey, action);
      return { status: 200, data: { prepared } };
    }

    const owner = tail[0];
    const sub = tail.slice(1).join("/");
    if (!owner || !sub) throw new ApiError(404, "NOT_FOUND", "Unknown vault endpoint.");

    if (method === "GET" && sub === "status") {
      const status = await api.getVaultStatus(owner);
      return { status: 200, data: { status: serializeStatus(status) } };
    }
    if (method === "GET" && sub === "activity") {
      return { status: 200, data: { activity: [] } };
    }
    if (method === "GET" && sub === "beneficiaries") {
      const status = await api.getVaultStatus(owner);
      const total = status.beneficiaries.reduce((sum, b) => sum + b.allocationBps, 0);
      return { status: 200, data: { beneficiaries: status.beneficiaries, totalAllocationBps: total } };
    }
    if (method === "GET" && (sub === "inheritance" || sub === "inheritance/eligibility")) {
      const status = await api.getVaultStatus(owner);
      return {
        status: 200,
        data: { missedCheckIns: status.missedCheckIns, maxMissedCheckIns: status.vault.maxMissedCheckIns, inheritanceEligible: status.inheritanceEligible }
      };
    }
    if (method === "GET" && sub === "inheritance/distribution") {
      const status = await api.getVaultStatus(owner);
      const assets: Json[] = status.tokens.map((token) => ({ asset: token, balance: status.balances[token]?.toString() ?? "0" }));
      return { status: 200, data: { assets } };
    }

    // Owner-scoped writes.
    const session = this.trySession(headers);
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "A Bearer session token is required.");
    if (method === "POST" && sub === "close") {
      const prepared = await this.deps.authenticatedApi.prepareOwnerTransaction(session.token, networkKey, { action: "close_vault" });
      return { status: 200, data: { prepared } };
    }
    if (method === "POST" && sub === "inheritance/checkin") {
      const prepared = await this.deps.authenticatedApi.prepareOwnerTransaction(session.token, networkKey, { action: "check_in" });
      return { status: 200, data: { prepared } };
    }
    if (method === "PUT" && sub === "beneficiaries") {
      const { accounts, allocationsBps } = parseBeneficiaries(body.beneficiaries);
      const prepared = await this.deps.authenticatedApi.prepareOwnerTransaction(session.token, networkKey, { action: "update_beneficiaries", accounts, allocationsBps });
      return { status: 200, data: { prepared } };
    }
    if (method === "DELETE" && sub === "beneficiaries") {
      const status = await api.getVaultStatus(owner);
      const first = status.beneficiaries[0]?.account;
      if (!first) throw new ApiError(400, "INVALID_ALLOCATION", "Vault has no beneficiary to keep.");
      const prepared = await this.deps.authenticatedApi.prepareOwnerTransaction(session.token, networkKey, { action: "update_beneficiaries", accounts: [first], allocationsBps: [10_000] });
      return { status: 200, data: { prepared } };
    }
    throw new ApiError(404, "NOT_FOUND", "Unknown vault endpoint.");
  }

  private async handleTransactions(method: string, networkKey: string, tail: string[], body: Json) {
    if (tail[0] === "prepare" && method === "POST") {
      const to = requiredString(body.to, "to");
      const data = requiredString(body.data, "data");
      const value = String(body.value ?? "0");
      const from = optionalString(body.from, "from");
      return { status: 200, data: { prepared: { chainId: this.network(networkKey).chainId, to: getAddress(to), data, value, from } } };
    }
    if (tail[0] === "simulate" && method === "POST") {
      const prepared = body.prepared as Record<string, unknown> | undefined;
      if (!prepared) throw new ApiError(400, "INVALID_INPUT", "prepared is required.");
      const to = requiredString(prepared.to, "prepared.to");
      const data = requiredString(prepared.data, "prepared.data");
      try {
        await this.rpc(networkKey).call(to, data);
        return { status: 200, data: { success: true, note: "Simulation is not confirmation." } };
      } catch (error) {
        return { status: 200, data: { success: false, revert: error instanceof Error ? error.message : "revert" } };
      }
    }
    if (tail[0] === "submit" && method === "POST") {
      requiredString(body.rawSignedTransaction, "rawSignedTransaction");
      return { status: 202, data: { status: "unbroadcast", note: "Sign and broadcast with the Kinn wallet; the API does not submit funds." } };
    }
    if (tail.length === 2 && method === "GET") {
      return { status: 200, data: { status: "unrecognized", hash: tail[1] } };
    }
    throw new ApiError(404, "NOT_FOUND", "Unknown transactions endpoint.");
  }

  private trySession(headers: Record<string, string>): WalletSession | undefined {
    try {
      return this.requireSession(headers);
    } catch {
      return undefined;
    }
  }
}

function parseBeneficiaries(value: unknown): { accounts: string[]; allocationsBps: number[] } {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "INVALID_ALLOCATION", "beneficiaries must be a non-empty array.");
  }
  const accounts: string[] = [];
  const allocationsBps: number[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new ApiError(400, "INVALID_ALLOCATION", "Invalid beneficiary entry.");
    const object = entry as Record<string, unknown>;
    const account = requiredString(object.account, "beneficiary.account");
    const bps = Number(object.allocationBps);
    if (!Number.isSafeInteger(bps) || bps <= 0 || bps > 10_000) {
      throw new ApiError(400, "INVALID_ALLOCATION", "allocationBps must be 1..10000.");
    }
    accounts.push(getAddress(account));
    allocationsBps.push(bps);
  }
  return { accounts, allocationsBps };
}

function serializeStatus(status: VaultStatus): Json {
  return {
    owner: status.vault.owner,
    address: status.vault.address,
    lastCheckIn: status.vault.lastCheckIn.toString(),
    checkInInterval: status.vault.checkInInterval.toString(),
    maxMissedCheckIns: status.vault.maxMissedCheckIns,
    active: status.vault.active,
    inheritanceTriggered: status.vault.inheritanceTriggered,
    automationReserve: status.vault.automationReserve.toString(),
    beneficiaries: status.beneficiaries,
    assets: status.tokens,
    balances: Object.fromEntries(Object.entries(status.balances).map(([k, v]) => [k, v.toString()])),
    nextExpectedCheckIn: status.nextExpectedCheckIn.toString(),
    missedCheckIns: status.missedCheckIns,
    inheritanceEligible: status.inheritanceEligible
  };
}
