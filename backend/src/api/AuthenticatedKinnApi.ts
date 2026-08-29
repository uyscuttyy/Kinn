import type { PrepareAction } from "./KinnApi.js";
import { KinnApi } from "./KinnApi.js";
import type { WalletAuthService } from "../auth/WalletAuthService.js";
import type { PreparedTransaction } from "../types.js";

export interface AuthorizedPreparedTransaction extends PreparedTransaction {
  from: string;
}

/** Owner-scoped write actions. The `owner` is bound to the verified session wallet
 *  inside prepareOwnerTransaction, so callers never supply it (prevents spoofing). */
export type OwnerPrepareAction =
  | { action: "create_vault"; interval: bigint; maxMisses: number; accounts: string[]; allocationsBps: number[]; reserve?: bigint }
  | { action: "update_settings"; interval: bigint; maxMisses: number }
  | { action: "update_beneficiaries"; accounts: string[]; allocationsBps: number[] }
  | { action: "approve_token"; token: string; amount: bigint }
  | { action: "deposit"; token: string; amount: bigint }
  | { action: "withdraw"; token: string; amount: bigint }
  | { action: "check_in" }
  | { action: "close_vault" }
  | { action: "top_up_automation_reserve"; amount: bigint }
  | { action: "withdraw_automation_reserve"; amount: bigint };

export class AuthenticatedKinnApi {
  constructor(private readonly apis: ReadonlyMap<string, KinnApi>, private readonly auth: WalletAuthService) {}

  async prepareOwnerTransaction(
    sessionToken: string,
    deploymentKey: string,
    request: OwnerPrepareAction
  ): Promise<AuthorizedPreparedTransaction> {
    const session = this.auth.requireSession(sessionToken, deploymentKey);
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    const action = { ...request, owner: session.wallet } as PrepareAction;
    const prepared = await api.prepareTransaction(action);
    return { ...prepared, from: session.wallet };
  }
}
