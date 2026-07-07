import { HttpError, forbidden, unauthorized } from "../utils/httpError.js";

export function authenticate(sessionService) {
  return async (req, _res, next) => {
    const token = req.cookies?.accessToken;
    if (!token) {
      next(unauthorized());
      return;
    }
    try {
      req.user = await sessionService.verifyAccessToken(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (req.user?.mustChangePassword) {
      next(new HttpError(403, "Password change required", "PASSWORD_CHANGE_REQUIRED"));
      return;
    }
    if (!req.user?.permissions?.includes(permission)) {
      next(forbidden());
      return;
    }
    next();
  };
}

export function requirePlantAccess() {
  return (req, _res, next) => {
    const requestedPlant = req.params.plantId ?? req.body?.plantId ?? req.query?.plantId;
    if (!requestedPlant || req.user.role === "ADMIN" || req.user.role === "MANAGER") {
      next();
      return;
    }
    if (!req.user.assignedPlants.includes(requestedPlant)) {
      next(forbidden("Plant access denied"));
      return;
    }
    req.plantFilter = { plantId: { $in: req.user.assignedPlants } };
    next();
  };
}

export function serverPlantFilter(user) {
  if (user.role === "TEAM_LEAD" || user.role === "STAFF") {
    return new Set(user.assignedPlants);
  }
  return null;
}
