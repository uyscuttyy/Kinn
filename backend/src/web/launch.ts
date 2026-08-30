import { createApiServer } from "./ApiServer.js";

const port = Number(process.env.KINN_API_PORT ?? process.env.PORT ?? "8080");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("KINN_API_PORT must be a valid TCP port");
}

createApiServer(port).listen();
