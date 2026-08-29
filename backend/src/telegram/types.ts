import type { AuthorizedPreparedTransaction, OwnerPrepareAction } from "../api/AuthenticatedKinnApi.js";
import type { TokenDisplay, VaultStatus } from "../types.js";
import type { WalletChallenge, WalletSession } from "../auth/WalletAuthService.js";

export interface TelegramMessage {
  chatId: string;
  telegramUserId: string;
  text: string;
}

export interface TelegramReplyOptions {
  signingRequest?: AuthorizedPreparedTransaction;
  walletChallenge?: WalletChallenge;
}

export interface TelegramTransport {
  sendMessage(chatId: string, text: string, options?: TelegramReplyOptions): Promise<void>;
}

export interface TelegramReminderControl {
  enable(chatId: string, telegramUserId: string, deploymentKey: string, wallet: string): Promise<void>;
  disable(telegramUserId: string, deploymentKey: string): Promise<void>;
  status(telegramUserId: string, deploymentKey: string): Promise<boolean>;
}

export interface TelegramGateway {
  listDeployments(): { key: string; chainId: number }[];
  createWalletChallenge(deploymentKey: string, telegramUserId: string, wallet: string): WalletChallenge;
  verifyWalletChallenge(nonce: string, signature: string): Promise<WalletSession>;
  getVaultStatus(deploymentKey: string, owner: string): Promise<VaultStatus>;
  parseTokenAmount(deploymentKey: string, token: string, amount: string): Promise<bigint>;
  getTokenDisplay(deploymentKey: string, owner: string, token: string, rawBalance: bigint): Promise<TokenDisplay>;
  prepareOwnerTransaction(
    sessionToken: string,
    deploymentKey: string,
    request: OwnerPrepareAction
  ): Promise<AuthorizedPreparedTransaction>;
}
