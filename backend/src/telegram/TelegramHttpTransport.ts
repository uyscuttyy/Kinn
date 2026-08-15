import type { TelegramReplyOptions, TelegramTransport } from "./types.js";
import { createTransactionCallback, resolveChainEnvironment } from "../wallet/transactionCallback.js";

function signingUrl(baseUrl: string, payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  )).toString("base64url");
  const url = new URL(baseUrl);
  url.hash = encoded;
  return url.toString();
}

function telegramAcceptsButtonUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export class TelegramHttpTransport implements TelegramTransport {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async sendMessage(chatId: string, text: string, options?: TelegramReplyOptions): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (options?.walletChallenge) {
      const walletAppUrl = process.env.WALLET_APP_URL;
      if (walletAppUrl) {
        const url = signingUrl(walletAppUrl, { kind: "wallet_challenge", challenge: options.walletChallenge });
        if (telegramAcceptsButtonUrl(url)) {
          body.reply_markup = { inline_keyboard: [[{ text: "Verify wallet", url }]] };
        } else {
          body.text = `${text}\n\nLocal wallet page (open on this computer):\n${url}`;
        }
      }
    } else if (options?.signingRequest) {
      const walletAppUrl = process.env.WALLET_APP_URL;
      if (walletAppUrl) {
        const callbackSecret = process.env.WALLET_CALLBACK_SECRET;
        const url = signingUrl(walletAppUrl, {
          kind: "transaction",
          transaction: options.signingRequest,
          explorerTxBaseUrl: resolveChainEnvironment(
            process.env, "WALLET_EXPLORER_TX_URL", options.signingRequest.chainId, "WALLET_EXPLORER_TX_URL"
          ),
          callback: callbackSecret
            ? createTransactionCallback(callbackSecret, chatId, options.signingRequest)
            : undefined
        });
        if (telegramAcceptsButtonUrl(url)) {
          body.reply_markup = { inline_keyboard: [[{ text: "Open wallet signing", url }]] };
        } else {
          body.text = `${text}\n\nLocal wallet page (open on this computer):\n${url}`;
        }
      }
    }
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}: ${result.description ?? "unknown error"}`);
    }
    if (!result.ok) throw new Error(result.description ?? "Telegram sendMessage failed");
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; from?: { id?: number | string }; text?: string };
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.message, cause?.code, cause?.message].filter(Boolean).join(" | ");
}

export class TelegramPollingClient {
  private offset = 0;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly onMessage: (message: { chatId: string; telegramUserId: string; text: string }) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async run(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          const chatId = update.message?.chat?.id;
          const userId = update.message?.from?.id;
          const text = update.message?.text;
          if (chatId === undefined || userId === undefined || !text) continue;
          await this.onMessage({ chatId: String(chatId), telegramUserId: String(userId), text });
        }
      } catch (error) {
        console.error("Telegram polling error:", errorDetail(error));
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  stop() { this.stopped = true; }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}`);
    if (!response.ok) throw new Error(`Telegram getUpdates failed with HTTP ${response.status}`);
    const result = await response.json() as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
    if (!result.ok) throw new Error(result.description ?? "Telegram getUpdates failed");
    return result.result ?? [];
  }
}
