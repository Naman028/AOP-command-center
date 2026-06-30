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

const blockedLowerKeys = new Set([...blockedLogKeys].map((key) => key.toLowerCase()));
const sensitiveStringPatterns = [
  /mongodb(?:\+srv)?:\/\/[^\s"']+/gi,
  /bearer\s+[a-z0-9._-]+/gi,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g
];

export function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        blockedLowerKeys.has(key.toLowerCase()) ? "[REDACTED]" : redactSensitive(child)
      ])
    );
  }
  if (typeof value === "string") {
    return sensitiveStringPatterns.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), value);
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
