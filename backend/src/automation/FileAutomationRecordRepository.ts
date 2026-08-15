import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AutomationRecord, AutomationRecordRepository } from "./AutomationWorker.js";

export class FileAutomationRecordRepository implements AutomationRecordRepository {
  constructor(private readonly path: string) {}
  async record(value: AutomationRecord) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  }
}
