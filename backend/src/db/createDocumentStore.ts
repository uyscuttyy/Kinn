import { JsonFileDocumentStore } from "./DocumentStore.js";

/** Default durable-store directory (override with KINN_DB_DIR). */
export function createDocumentStore(env: NodeJS.ProcessEnv = process.env): JsonFileDocumentStore {
  return new JsonFileDocumentStore(env.KINN_DB_DIR ?? "data/db");
}
