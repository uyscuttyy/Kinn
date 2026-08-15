import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hashData, resolveChainEnvironment, verifyTransactionCallback, type TransactionCallback
} from "./transactionCallback.js";

const port = Number(process.env.PORT ?? process.env.KINN_WALLET_PORT ?? "4173");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT or KINN_WALLET_PORT must be a valid TCP port");
}
const logo = readFileSync(resolve(process.cwd(), "kinnn.jpg"));
const walletClient = readFileSync(resolve(process.cwd(), "dist/wallet-client.js"));
const walletConnectProjectId = process.env.WALLETCONNECT_PROJECT_ID?.trim() ?? "";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kinn Wallet Authorization</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; background: #eef1f5; color: #16181d; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 50% 18%, #ffffff 0, #eef1f5 44%, #e5e9ef 100%); }
    main { width: min(100%, 560px); background: #ffffffee; border: 1px solid #ffffff; border-radius: 22px; padding: 30px; box-shadow: 0 28px 70px #17203326, 0 8px 24px #17203312; backdrop-filter: blur(12px); transform: translateY(-4px); }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; font-weight: 750; letter-spacing: .02em; }
    .logo { display: block; width: 42px; height: 42px; object-fit: contain; border-radius: 12px; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: 0; }
    p { color: #555b66; line-height: 1.5; }
    .details { display: grid; gap: 10px; margin: 20px 0; padding: 16px; background: #f4f5f7; border: 1px solid #e4e7eb; border-radius: 14px; }
    .detail { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; }
    .detail span:first-child { color: #69717d; }
    .detail span:last-child { max-width: 70%; overflow-wrap: anywhere; text-align: right; font-weight: 600; }
    button { width: 100%; min-height: 50px; border: 0; border-radius: 14px; background: #111318; color: white; font: inherit; font-weight: 650; cursor: pointer; box-shadow: 0 8px 18px #1113181f; }
    button.secondary { margin-top: 10px; background: white; color: #16181d; border: 1px solid #cfd4dc; }
    a.secondary { display: grid; place-items: center; width: 100%; min-height: 50px; margin-top: 10px; border-radius: 14px; color: #16181d; border: 1px solid #cfd4dc; text-decoration: none; font-weight: 650; }
    button:disabled { opacity: .55; cursor: wait; }
    pre { margin: 16px 0 0; padding: 14px; overflow-wrap: anywhere; white-space: pre-wrap; background: #f4f5f7; border-radius: 14px; font-size: 13px; }
    @media (max-width: 540px) { body { padding: 14px; } main { padding: 24px 20px; border-radius: 18px; transform: none; } }
    .error { color: #a52626; }
  </style>
</head>
<body>
  <main>
    <div class="brand"><img class="logo" src="/kinn-logo.jpg" alt="Kinn logo"><span>Kinn</span></div>
    <h1 id="title">Wallet authorization</h1>
    <p id="summary">Review the request before connecting your wallet.</p>
    <section id="details" class="details" hidden></section>
    <button id="sign">Connect browser wallet</button>
    <button id="walletconnect" class="secondary" hidden>Connect with WalletConnect</button>
    <button id="copy" class="secondary" hidden>Copy verification command</button>
    <a id="explorer" class="secondary" target="_blank" rel="noopener noreferrer" hidden>View transaction</a>
    <pre id="result" hidden></pre>
  </main>
  <script type="text/plain">
    const button = document.querySelector('#sign');
    const result = document.querySelector('#result');
    const title = document.querySelector('#title');
    const summary = document.querySelector('#summary');
    const details = document.querySelector('#details');
    const copy = document.querySelector('#copy');
    const explorer = document.querySelector('#explorer');
    const metaMaskDeepLink = 'https://metamask.app.link/dapp/' + location.href.replace(/^https?:\\/\\//, '');
    let copyText = '';
    const addDetail = (label, value) => {
      const row = document.createElement('div');
      row.className = 'detail';
      row.innerHTML = '<span></span><span></span>';
      row.children[0].textContent = label;
      row.children[1].textContent = value;
      details.appendChild(row);
    };
    const copyValue = async (value) => {
      try { await navigator.clipboard.writeText(value); return true; } catch {}
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.focus(); area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch {}
      area.remove();
      return copied;
    };
    const show = (message, error = false) => {
      result.hidden = false;
      result.className = error ? 'error' : '';
      result.textContent = message;
    };
    const waitForReceipt = async (txHash) => {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (receipt) return receipt;
        show('Transaction pending. Keep this page open.\\n\\n' + txHash);
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
      return null;
    };
    const decode = () => {
      if (!location.hash.slice(1)) throw new Error('No Kinn signing request was provided.');
      const base64 = location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(base64))));
    };
    let initialPayload;
    try {
      initialPayload = decode();
      if (initialPayload.kind === 'wallet_challenge') {
        title.textContent = 'Kinn wallet verification';
        summary.textContent = 'Sign a wallet ownership message. This signature cannot move funds.';
        button.textContent = 'Connect MetaMask and sign';
        details.hidden = false;
        addDetail('Network', initialPayload.challenge.deploymentKey);
        addDetail('Wallet', initialPayload.challenge.message.wallet);
        addDetail('Expires', new Date(Number(initialPayload.challenge.message.expiresAt) * 1000).toLocaleString());
      } else if (initialPayload.kind === 'transaction') {
        title.textContent = 'Kinn transaction';
        summary.textContent = 'Review and submit this Kinn transaction on chain ' + initialPayload.transaction.chainId + '.';
        button.textContent = 'Review in MetaMask';
        details.hidden = false;
        addDetail('Network', 'Chain ' + initialPayload.transaction.chainId);
        addDetail('From', initialPayload.transaction.from || 'MetaMask account');
        addDetail('To', initialPayload.transaction.to);
        addDetail('Value', initialPayload.transaction.value || '0x0');
        if (!window.ethereum && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          button.textContent = 'Open in MetaMask';
          summary.textContent = 'Continue in the MetaMask mobile app to review this transaction.';
        }
      } else {
        throw new Error('Unknown Kinn authorization request.');
      }
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
      button.disabled = true;
    }
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (!window.ethereum) {
          if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            location.href = metaMaskDeepLink;
            return;
          }
          throw new Error('MetaMask was not detected in this browser.');
        }
        const payload = initialPayload;
        if (payload.kind === 'transaction') {
          const transaction = payload.transaction;
          const expectedChain = '0x' + Number(transaction.chainId).toString(16);
          const currentChain = await ethereum.request({ method: 'eth_chainId' });
          if (currentChain.toLowerCase() !== expectedChain.toLowerCase()) {
            await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: expectedChain }] });
          }
          const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
          const account = accounts[0];
          if (account.toLowerCase() !== transaction.from.toLowerCase()) {
            throw new Error('MetaMask is connected to a different wallet: ' + account);
          }
          const txHash = await ethereum.request({
            method: 'eth_sendTransaction',
            params: [{ from: account, to: transaction.to, data: transaction.data, value: transaction.value }]
          });
          if (payload.explorerTxBaseUrl) {
            explorer.href = payload.explorerTxBaseUrl.replace(/\\/$/, '') + '/' + txHash;
            explorer.hidden = false;
          }
          button.hidden = true;
          show('Transaction submitted and waiting for confirmation.\\n\\n' + txHash);
          const receipt = await waitForReceipt(txHash);
          if (!receipt) {
            show('Confirmation is taking longer than expected. The transaction may still confirm.\\n\\n' + txHash);
            return;
          }
          const succeeded = BigInt(receipt.status) === 1n;
          let telegramNotified = false;
          if (succeeded && payload.callback) {
            try {
              const callbackResponse = await fetch('/api/transaction-result', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ callback: payload.callback, txHash })
              });
              telegramNotified = callbackResponse.ok;
            } catch {}
          }
          show(
            (succeeded ? 'Transaction confirmed.' : 'Transaction failed.') +
            '\\n\\nHash: ' + txHash +
            '\\nBlock: ' + BigInt(receipt.blockNumber).toString() +
            (telegramNotified ? '\\n\\nTelegram has been notified.' : '\\n\\nReturn to Telegram.'),
            !succeeded
          );
          return;
        }
        if (payload.kind !== 'wallet_challenge') throw new Error('This signing request is not a wallet challenge.');
        const challenge = payload.challenge;
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        const account = accounts[0];
        if (account.toLowerCase() !== challenge.message.wallet.toLowerCase()) {
          throw new Error('MetaMask is connected to a different wallet: ' + account);
        }
        const typedData = {
          domain: challenge.domain,
          types: { EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ], ...challenge.types },
          primaryType: challenge.primaryType,
          message: challenge.message
        };
        const signature = await ethereum.request({
          method: 'eth_signTypedData_v4',
          params: [account, JSON.stringify(typedData)]
        });
        const command = '/verify ' + challenge.message.nonce + ' ' + signature;
        copyText = command;
        copy.hidden = false;
        const copied = await copyValue(command);
        show('Signature created. Send this command to the Kinn Telegram bot:\\n\\n' + command + (copied ? '\\n\\nCopied to clipboard.' : '\\n\\nUse the Copy button or select the command manually.'));
      } catch (error) {
        show(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
      }
    });
    copy.addEventListener('click', async () => {
      const copied = await copyValue(copyText);
      show(copied ? 'Verification command copied. Return to Telegram and send it.' : 'Select and copy the verification command above manually.');
    });
  </script>
  <script>window.KINN_WALLET_CONFIG = ${JSON.stringify({ walletConnectProjectId })};</script>
  <script src="/wallet-client.js"></script>
</body>
</html>`;

async function readBody(request: import("node:http").IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request body too large");
  }
  return JSON.parse(body) as { callback?: TransactionCallback; txHash?: string };
}

async function handleTransactionResult(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) {
  const secret = process.env.WALLET_CALLBACK_SECRET;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!secret || !botToken) throw new Error("Transaction callback service is not configured");
  const body = await readBody(request);
  if (!body.callback || !body.txHash || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) throw new Error("Invalid transaction callback payload");
  const callback = body.callback;
  if (!verifyTransactionCallback(secret, callback)) throw new Error("Invalid or expired transaction callback");
  const rpcUrl = resolveChainEnvironment(process.env, "KINN_RPC_URL", callback.chainId, "KINN_RPC_URL");
  if (!rpcUrl) throw new Error(`No callback RPC configured for chain ${callback.chainId}`);

  const rpc = async (method: string, params: unknown[]) => {
    const result = await fetch(rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    if (!result.ok) throw new Error(`RPC request failed with HTTP ${result.status}`);
    const json = await result.json() as { result?: any; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? "RPC request failed");
    return json.result;
  };
  const [receipt, transaction] = await Promise.all([
    rpc("eth_getTransactionReceipt", [body.txHash]),
    rpc("eth_getTransactionByHash", [body.txHash])
  ]);
  if (!receipt || !transaction) throw new Error("Transaction is not confirmed yet");
  if (Number.parseInt(receipt.status, 16) !== 1) throw new Error("Transaction failed on chain");
  if (Number.parseInt(transaction.chainId ?? "0", 16) !== callback.chainId) throw new Error("Transaction chain mismatch");
  if (transaction.from.toLowerCase() !== callback.from || transaction.to.toLowerCase() !== callback.to) {
    throw new Error("Transaction sender or recipient mismatch");
  }
  if (hashData(transaction.input) !== callback.dataHash) throw new Error("Transaction calldata mismatch");

  const message = `Kinn transaction confirmed.\n\nTransaction: ${body.txHash}\nBlock: ${Number.parseInt(receipt.blockNumber, 16)}\nFrom: ${transaction.from}\nTo: ${transaction.to}`;
  const telegram = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: callback.chatId, text: message })
  });
  if (!telegram.ok) throw new Error(`Telegram notification failed with HTTP ${telegram.status}`);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ status: "notified" }));
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/transaction-result") {
    try {
      await handleTransactionResult(request, response);
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Transaction callback failed" }));
    }
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify({ status: "ok", service: "kinn-wallet" }));
    return;
  }
  if (request.url === "/kinn-logo.jpg") {
    response.writeHead(200, {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=3600",
      "content-length": logo.byteLength
    });
    response.end(logo);
    return;
  }
  if (request.url === "/wallet-client.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-length": walletClient.byteLength
    });
    response.end(walletClient);
    return;
  }
  if (request.url !== "/" && request.url !== "/index.html") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https: wss:; img-src 'self' data: https:; frame-src https:; frame-ancestors 'none'"
  });
  response.end(html);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Kinn wallet authorization page listening on 0.0.0.0:${port}`);
});
