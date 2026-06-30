import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { permissionsForRole } from "../constants/permissions.js";
import { unauthorized } from "../utils/httpError.js";

const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000;

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    assignedPlants: user.assignedPlants,
    permissions: permissionsForRole(user.role)
  };
}

export function accessCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    domain: config.cookieDomain || undefined,
    maxAge: accessTokenTtlSeconds * 1000,
    path: "/"
  };
}

export function refreshCookieOptions(config) {
  return {
    ...accessCookieOptions(config),
    maxAge: refreshTokenTtlMs
  };
}

export function createSessionService({ config, store, auditService }) {
  function signAccessToken(user, session) {
    return jwt.sign(
      {
        sub: user.id,
        sid: session.id,
        role: user.role,
        assignedPlants: user.assignedPlants,
        permissions: permissionsForRole(user.role)
      },
      config.accessTokenSecret,
      { expiresIn: accessTokenTtlSeconds, jwtid: uuidv4() }
    );
  }

  async function issueRefreshSession(user, req) {
    const refreshToken = crypto.randomBytes(48).toString("base64url");
    const jti = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, config.bcryptWorkFactor);
    const session = {
      id: uuidv4(),
      userId: user.id,
      refreshTokenHash,
      jti,
      expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      revokedAt: null,
      lastUsedAt: new Date(),
      ipHash: crypto.createHash("sha256").update(req.ip ?? "").digest("hex"),
      userAgentHash: crypto.createHash("sha256").update(req.get("user-agent") ?? "").digest("hex")
    };
    store.sessions.push(session);
    return { refreshToken, session };
  }

  async function setAuthCookies(res, user, req) {
    const { refreshToken, session } = await issueRefreshSession(user, req);
    const accessToken = signAccessToken(user, session);
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    res.cookie("accessToken", accessToken, accessCookieOptions(config));
    res.cookie("refreshToken", refreshToken, refreshCookieOptions(config));
    res.cookie("csrfToken", csrfToken, {
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      domain: config.cookieDomain || undefined,
      maxAge: refreshTokenTtlMs,
      path: "/"
    });
    return csrfToken;
  }

  function clearAuthCookies(res) {
    for (const name of ["accessToken", "refreshToken", "csrfToken"]) {
      res.clearCookie(name, { path: "/", domain: config.cookieDomain || undefined });
    }
  }

  function verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, config.accessTokenSecret);
      const session = store.sessions.find(
        (candidate) => candidate.id === payload.sid && !candidate.revokedAt && candidate.expiresAt > new Date()
      );
      if (!session) {
        throw unauthorized();
      }
      const user = store.users.find((candidate) => candidate.id === payload.sub && candidate.isActive);
      if (!user) {
        throw unauthorized();
      }
      return publicUser(user);
    } catch {
      throw unauthorized();
    }
  }

  async function rotateRefreshToken(refreshToken, req, res) {
    const activeSessions = store.sessions.filter(
      (session) => !session.revokedAt && session.expiresAt > new Date()
    );
    for (const session of activeSessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        const user = store.users.find((candidate) => candidate.id === session.userId && candidate.isActive);
        if (!user) {
          throw unauthorized();
        }
        session.revokedAt = new Date();
        session.lastUsedAt = new Date();
        const csrfToken = await setAuthCookies(res, user, req);
        auditService.record({
          actorUserId: user.id,
          action: "REFRESH_TOKEN_USED",
          entityType: "Session",
          entityId: session.id,
          requestId: req.id
        });
        return { user: publicUser(user), csrfToken };
      }
    }
    throw unauthorized();
  }

  async function revokeCurrentRefreshToken(refreshToken) {
    if (!refreshToken) {
      return false;
    }
    for (const session of store.sessions.filter((candidate) => !candidate.revokedAt)) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        session.revokedAt = new Date();
        return true;
      }
    }
    return false;
  }

  function revokeUserSessions(userId) {
    for (const session of store.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  }

  return {
    publicUser,
    setAuthCookies,
    clearAuthCookies,
    verifyAccessToken,
    rotateRefreshToken,
    revokeCurrentRefreshToken,
    revokeUserSessions
  };
}
