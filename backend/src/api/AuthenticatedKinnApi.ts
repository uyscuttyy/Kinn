import type { PrepareAction } from "./KinnApi.js";
import { KinnApi } from "./KinnApi.js";
import type { WalletAuthService } from "../auth/WalletAuthService.js";
import type { PreparedTransaction } from "../types.js";

export interface AuthorizedPreparedTransaction extends PreparedTransaction {
  from: string;
}

export class AuthenticatedKinnApi {
  constructor(private readonly apis: ReadonlyMap<string, KinnApi>, private readonly auth: WalletAuthService) {}

  prepareOwnerTransaction(
    sessionToken: string,
    deploymentKey: string,
    request: Exclude<PrepareAction, { action: "trigger_inheritance" | "distribute_token" | "retry_distribution" }>
  ): AuthorizedPreparedTransaction {
    const session = this.auth.requireSession(sessionToken, deploymentKey);
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    return { ...api.prepareTransaction(request), from: session.wallet };
  }
}
