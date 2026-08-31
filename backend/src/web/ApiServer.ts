import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EthersRpcClient } from "../blockchain/RpcClient.js";
import { KinnContractService } from "../blockchain/KinnContractService.js";
import { KinnApi } from "../api/KinnApi.js";
import { AuthenticatedKinnApi } from "../api/AuthenticatedKinnApi.js";
import { WalletAuthService, InMemoryWalletAssociationRepository } from "../auth/WalletAuthService.js";
import { DeploymentRegistry } from "../deployments/DeploymentRegistry.js";
import { loadNetworkConfigs } from "../deployments/loadNetworkConfigs.js";
import { KinnHttpApi } from "./KinnHttpApi.js";
import { DurableVaultEventRepository } from "../db/DurableVaultEventRepository.js";
import { createDocumentStore } from "../db/createDocumentStore.js";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function headers(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

/**
 * Web-App REST API server (Phase 6 final milestone). Mounts `/api/v1/:networkKey`
 * onto `KinnHttpApi` and exposes a `/health` probe. BigInts are serialized as
 * decimal strings. The API never signs or broadcasts funds; it returns unsigned
 * transactions for the first-party KeyManager wallet to broadcast.
 */
export function createApiServer(port: number, env: NodeJS.ProcessEnv = process.env) {
  const networkConfigs = loadNetworkConfigs(env);
  const configByKey = new Map(networkConfigs.map((config) => [config.key, config]));
  const rpcByKey = new Map(networkConfigs.map((config) => [config.key, new EthersRpcClient(config.rpcUrl)]));
  const apis = new Map<string, KinnApi>();
  for (const config of networkConfigs) {
    const rpc = rpcByKey.get(config.key)!;
    apis.set(config.key, new KinnApi(new KinnContractService(rpc, config.contractAddress, config.chainId)));
  }
  const deployments = new DeploymentRegistry(networkConfigs.map(({ key, chainId, contractAddress }) => ({ key, chainId, contractAddress })));
  const auth = new WalletAuthService(deployments, new InMemoryWalletAssociationRepository());
  const authenticatedApi = new AuthenticatedKinnApi(apis, auth);
  const events = new DurableVaultEventRepository(createDocumentStore(env));
  const httpApi = new KinnHttpApi({
    deployments,
    auth,
    apis,
    authenticatedApi,
    rpc: rpcByKey,
    networkConfigs: configByKey,
    env,
    events
  });

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = request.url ?? "/";
      if (url === "/health") {
        writeJson(response, 200, { status: "ok", service: "kinn-api" });
        return;
      }
      if (!url.startsWith("/api/v1/")) {
        writeJson(response, 404, { error: "NOT_FOUND", message: "Not found." });
        return;
      }
      const body = await readBody(request);
      const result = await httpApi.handle(method, url, headers(request), body);
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      writeJson(response, 500, { error: "INTERNAL", message });
    }
  });

  return {
    server,
    listen() {
      server.listen(port, "0.0.0.0", () => {
        console.log(`Kinn Web-App API listening on 0.0.0.0:${port}`);
      });
    }
  };
}

function writeJson(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}
