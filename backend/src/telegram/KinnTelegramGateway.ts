import type { AuthenticatedKinnApi } from "../api/AuthenticatedKinnApi.js";
import type { KinnApi, PrepareAction } from "../api/KinnApi.js";
import type { WalletAuthService } from "../auth/WalletAuthService.js";
import type { DeploymentRegistry } from "../deployments/DeploymentRegistry.js";
import type { TelegramGateway } from "./types.js";

export class KinnTelegramGateway implements TelegramGateway {
  constructor(
    private readonly deployments: DeploymentRegistry,
    private readonly auth: WalletAuthService,
    private readonly authenticatedApi: AuthenticatedKinnApi,
    private readonly apis: ReadonlyMap<string, KinnApi>
  ) {}

  listDeployments() {
    return this.deployments.list().map(({ key, chainId }) => ({ key, chainId }));
  }

  createWalletChallenge(deploymentKey: string, telegramUserId: string, wallet: string) {
    return this.auth.createChallenge(deploymentKey, telegramUserId, wallet);
  }

  verifyWalletChallenge(nonce: string, signature: string) {
    return this.auth.verifyChallenge(nonce, signature);
  }

  getVaultStatus(deploymentKey: string, owner: string) {
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    return api.getVaultStatus(owner);
  }

  parseTokenAmount(deploymentKey: string, token: string, amount: string) {
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    return api.parseTokenAmount(token, amount);
  }

  getTokenDisplay(deploymentKey: string, owner: string, token: string, rawBalance: bigint) {
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    return api.getTokenDisplay(owner, token, rawBalance);
  }

  prepareOwnerTransaction(
    sessionToken: string,
    deploymentKey: string,
    request: Exclude<PrepareAction, { action: "trigger_inheritance" | "distribute_token" | "retry_distribution" }>
  ) {
    return this.authenticatedApi.prepareOwnerTransaction(sessionToken, deploymentKey, request);
  }
}
