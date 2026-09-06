import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, resolve, sep } from "node:path";
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
  const webRoot = resolve(process.cwd(), env.KINN_WEB_ROOT ?? "frontend/dist");
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
      if (url === "/health" || url.startsWith("/health?")) {
        writeJson(response, 200, { status: "ok", service: "kinn-api" });
        return;
      }
      if (url.startsWith("/api/v1/")) {
        const body = await readBody(request);
        const result = await httpApi.handle(method, url, headers(request), body);
        response.writeHead(result.status, result.headers);
        response.end(result.body);
        return;
      }
      // Single-service live deploy: every non-API route serves the built web
      // app (KINN_WEB_ROOT, default "frontend/dist"), with SPA fallback to
      // index.html. When the directory is absent (local dev via vite) this
      // falls through to the JSON 404, preserving old behavior.
      if (method === "GET" || method === "HEAD") {
        if (await serveStatic(url, response, webRoot)) return;
      }
      writeJson(response, 404, { error: "NOT_FOUND", message: "Not found." });
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

function writeJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(data));
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve the built web app for a single-service deploy. Returns true when the
 * response was handled (file served). Path traversal is blocked; extensionless
 * routes fall back to index.html for client-side routing.
 */
async function serveStatic(rawUrl: string, response: ServerResponse, webRoot: string): Promise<boolean> {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return false;
  }
  let rel = normalize(pathname).replace(/^(\.\.+)?[/\\]+/, "");
  if (rel === "" || pathname.endsWith("/")) rel = join(rel, "index.html");
  let file = join(webRoot, rel);
  if (file !== webRoot && !file.startsWith(webRoot + sep)) return false;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    if (extname(rel) !== "") return false;
    file = join(webRoot, "index.html");
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return false;
  }
  const isEntry = file === join(webRoot, "index.html");
  response.writeHead(200, {
    "content-type": STATIC_MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": isEntry ? "no-store" : "public, max-age=31536000, immutable",
  });
  response.end(body);
  return true;
}
