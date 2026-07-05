import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { permissionsForRole } from "../constants/permissions.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { unauthorized } from "../utils/httpError.js";

const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000;

function publicUser(user) {
  const normalized = normalizeUser(user);
  return {
    id: normalized.id,
    email: normalized.email,
    name: normalized.name,
    role: normalized.role,
    assignedPlants: normalized.assignedPlants,
    permissions: permissionsForRole(normalized.role)
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
    const normalized = publicUser(user);
    return jwt.sign(
      {
        sub: normalized.id,
        sid: session.id,
        role: normalized.role,
        assignedPlants: normalized.assignedPlants,
        permissions: normalized.permissions
      },
      config.accessTokenSecret,
      { expiresIn: accessTokenTtlSeconds, jwtid: uuidv4() }
    );
  }

  async function issueRefreshSession(user, req) {
    const normalized = publicUser(user);
    const refreshToken = crypto.randomBytes(48).toString("base64url");
    const jti = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, config.bcryptWorkFactor);
    const session = {
      id: uuidv4(),
      userId: normalized.id,
      refreshTokenHash,
      jti,
      expiresAt: new Date(Date.now() + refreshTokenTtlMs),
      revokedAt: null,
      lastUsedAt: new Date(),
      ipHash: crypto.createHash("sha256").update(req.ip ?? "").digest("hex"),
      userAgentHash: crypto.createHash("sha256").update(req.get("user-agent") ?? "").digest("hex")
    };
    if (store.useMongo) {
      const created = await Session.create({
        userId: normalized.id,
        refreshTokenHash,
        jti,
        expiresAt: session.expiresAt,
        revokedAt: null,
        lastUsedAt: session.lastUsedAt,
        ipHash: session.ipHash,
        userAgentHash: session.userAgentHash
      });
      return { refreshToken, session: normalizeSession(created) };
    }
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

  async function verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, config.accessTokenSecret);
      const session = await findActiveSessionById(payload.sid);
      if (!session) {
        throw unauthorized();
      }
      const user = await findActiveUserById(payload.sub);
      if (!user) {
        throw unauthorized();
      }
      return publicUser(user);
    } catch {
      throw unauthorized();
    }
  }

  async function rotateRefreshToken(refreshToken, req, res) {
    const activeSessions = await listActiveSessions();
    for (const session of activeSessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        const user = await findActiveUserById(session.userId);
        if (!user) {
          throw unauthorized();
        }
        await revokeSession(session.id);
        const csrfToken = await setAuthCookies(res, user, req);
        await auditService.record({
          actorUserId: publicUser(user).id,
          action: "REFRESH_TOKEN_USED",
          entityType: "Session",
          entityId: session.id,
          requestId: req.id
        }, req);
        return { user: publicUser(user), csrfToken };
      }
    }
    throw unauthorized();
  }

  async function revokeCurrentRefreshToken(refreshToken) {
    if (!refreshToken) {
      return false;
    }
    for (const session of await listActiveSessions()) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
        await revokeSession(session.id);
        return true;
      }
    }
    return false;
  }

  async function revokeUserSessions(userId) {
    if (store.useMongo) {
      await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      return;
    }
    for (const session of store.sessions) {
      if (String(session.userId) === String(userId) && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
  }

  async function findActiveSessionById(id) {
    if (store.useMongo) {
      const session = await Session.findOne({ _id: id, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
      return normalizeSession(session);
    }
    return store.sessions.find((candidate) => candidate.id === id && !candidate.revokedAt && candidate.expiresAt > new Date());
  }

  async function findActiveUserById(id) {
    if (store.useMongo) {
      return User.findOne({ _id: id, isActive: true }).lean();
    }
    return store.users.find((candidate) => candidate.id === id && candidate.isActive);
  }

  async function listActiveSessions() {
    if (store.useMongo) {
      const sessions = await Session.find({ revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
      return sessions.map(normalizeSession);
    }
    return store.sessions.filter((session) => !session.revokedAt && session.expiresAt > new Date());
  }

  async function revokeSession(id) {
    if (store.useMongo) {
      await Session.updateOne({ _id: id }, { $set: { revokedAt: new Date(), lastUsedAt: new Date() } });
      return;
    }
    const session = store.sessions.find((candidate) => candidate.id === id);
    if (session) {
      session.revokedAt = new Date();
      session.lastUsedAt = new Date();
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

export function normalizeUser(user) {
  if (!user) {
    return user;
  }
  const record = user.toObject?.() ?? user;
  return {
    ...record,
    id: String(record._id ?? record.id),
    assignedPlants: record.assignedPlants ?? []
  };
}

function normalizeSession(session) {
  if (!session) {
    return session;
  }
  const record = session.toObject?.() ?? session;
  return {
    ...record,
    id: String(record._id ?? record.id),
    userId: String(record.userId)
  };
}
