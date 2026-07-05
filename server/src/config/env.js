export function loadConfig(overrides = {}) {
  const nodeEnv = overrides.NODE_ENV ?? process.env.NODE_ENV ?? "development";
  const clientOrigins = overrides.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGINS ?? "http://localhost:5173";
  const mongoUri = overrides.MONGODB_URI ?? process.env.MONGODB_URI ?? (nodeEnv === "production" ? undefined : "mongodb://localhost:27017/aop_command_center_dev");
  const accessTokenSecret = overrides.ACCESS_TOKEN_SECRET ?? process.env.ACCESS_TOKEN_SECRET ?? "dev-access-secret-change-me";
  const refreshTokenSecret = overrides.REFRESH_TOKEN_SECRET ?? process.env.REFRESH_TOKEN_SECRET ?? "dev-refresh-secret-change-me";
  const isProduction = nodeEnv === "production";

  if (isProduction && (!mongoUri || accessTokenSecret.startsWith("dev-") || refreshTokenSecret.startsWith("dev-"))) {
    throw new Error("Production requires MONGODB_URI and strong token secrets");
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(overrides.PORT ?? process.env.PORT ?? 4000),
    host: overrides.HOST ?? process.env.HOST ?? "0.0.0.0",
    trustProxy: parseTrustProxy(overrides.TRUST_PROXY ?? process.env.TRUST_PROXY ?? (isProduction ? "1" : "false")),
    clientOrigins: clientOrigins.split(",").map((origin) => origin.trim()).filter(Boolean),
    mongoUri,
    accessTokenSecret,
    refreshTokenSecret,
    cookieDomain: overrides.COOKIE_DOMAIN ?? process.env.COOKIE_DOMAIN,
    cookieSecure: String(overrides.COOKIE_SECURE ?? process.env.COOKIE_SECURE ?? nodeEnv === "production") === "true",
    cookieSameSite: overrides.COOKIE_SAMESITE ?? process.env.COOKIE_SAMESITE ?? "lax",
    bcryptWorkFactor: Number(overrides.BCRYPT_WORK_FACTOR ?? process.env.BCRYPT_WORK_FACTOR ?? 12),
    uploadMaxBytes: Number(overrides.UPLOAD_MAX_BYTES ?? process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024),
    maxImportRows: Number(overrides.IMPORT_MAX_ROWS ?? process.env.IMPORT_MAX_ROWS ?? 5000),
    maxImportCells: Number(overrides.IMPORT_MAX_CELLS ?? process.env.IMPORT_MAX_CELLS ?? 50000)
  };
}

function parseTrustProxy(value) {
  if (value === true || value === "true") return 1;
  if (value === false || value === "false" || value === "0") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}
