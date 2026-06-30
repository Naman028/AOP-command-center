const blockedLogKeys = new Set([
  "password",
  "passwordHash",
  "cookie",
  "cookies",
  "authorization",
  "accessToken",
  "refreshToken",
  "token",
  "mongodbUri",
  "MONGODB_URI"
]);

export function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        blockedLogKeys.has(key) ? "[REDACTED]" : redactSensitive(child)
      ])
    );
  }
  return value;
}

export function containsUnsafeMongoOperator(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, child]) => (
    key.startsWith("$") || key.includes(".") || containsUnsafeMongoOperator(child)
  ));
}

export function escapeFormulaValue(value) {
  if (typeof value !== "string") {
    return value;
  }
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}
