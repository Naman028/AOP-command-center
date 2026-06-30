import crypto from "node:crypto";
import { redactSensitive } from "../utils/sanitize.js";

export function hashClientValue(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createAuditService(store) {
  return {
    record(event) {
      const entry = {
        ...redactSensitive(event),
        timestamp: new Date().toISOString()
      };
      store.auditLogs.push(entry);
      return entry;
    }
  };
}
