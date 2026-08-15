import type { TelegramTransport } from "../telegram/types.js";
import type { KinnApi } from "../api/KinnApi.js";
import type { ReminderNotifier, ReminderStatusReader } from "./ReminderService.js";

export class TelegramReminderNotifier implements ReminderNotifier {
  constructor(private readonly transport: TelegramTransport) {}
  send(chatId: string, text: string) { return this.transport.sendMessage(chatId, text); }
}

export class MultiNetworkReminderStatusReader implements ReminderStatusReader {
  constructor(private readonly apis: ReadonlyMap<string, KinnApi>) {}
  getVaultStatus(deploymentKey: string, wallet: string) {
    const api = this.apis.get(deploymentKey);
    if (!api) throw new Error(`No API configured for deployment: ${deploymentKey}`);
    return api.getVaultStatus(wallet);
  }
}
