import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { HttpError } from "../utils/httpError.js";

export function configureProxy(app, config) {
  if (config.isProduction) {
    app.set("trust proxy", 1);
    app.use((req, _res, next) => {
      if (req.secure || req.get("x-forwarded-proto") === "https") {
        next();
        return;
      }
      next(new HttpError(400, "HTTPS is required", "HTTPS_REQUIRED"));
    });
  }
}

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  });
}

export function corsAllowlist(config) {
  return cors({
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin not allowed", "ORIGIN_FORBIDDEN"));
    },
    credentials: true
  });
}

export function generalRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
  });
}

export function createLoginRateLimiter() {
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 5;

  return (req, _res, next) => {
    const email = String(req.body?.email ?? "").toLowerCase();
    const key = `${req.ip}:${email}`;
    const now = Date.now();
    const current = attempts.get(key) ?? { count: 0, resetAt: now + windowMs };
    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }
    current.count += 1;
    attempts.set(key, current);
    if (current.count > maxAttempts) {
      next(new HttpError(429, "Too many login attempts", "RATE_LIMITED"));
      return;
    }
    next();
  };
}

export function originAndCsrf(config) {
  return (req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    if (!origin || !config.clientOrigins.includes(origin)) {
      next(new HttpError(403, "Origin not allowed", "ORIGIN_FORBIDDEN"));
      return;
    }
    if (req.path.startsWith("/api/auth/login") || req.path.startsWith("/api/auth/refresh")) {
      next();
      return;
    }
    const csrfCookie = req.cookies?.csrfToken;
    const csrfHeader = req.get("x-csrf-token");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      next(new HttpError(403, "CSRF validation failed", "CSRF_FAILED"));
      return;
    }
    next();
  };
}
