export function notFound(_req, _res, next) {
  const error = new Error("Not found");
  error.status = 404;
  error.code = "NOT_FOUND";
  next(error);
}

export function errorHandler(config, auditService) {
  return (error, req, res, _next) => {
    const status = Number(error.status ?? error.statusCode ?? (error.code === "LIMIT_FILE_SIZE" ? 413 : 500));
    if (status === 401 || status === 403) {
      void auditService.record({
        actorUserId: req.user?.id,
        action: "ACCESS_DENIED",
        entityType: "Route",
        entityId: req.path,
        requestId: req.id
      }, req).catch(() => {});
    }
    res.status(status).json({
      error: {
        code: error.code ?? "INTERNAL_ERROR",
        message: status >= 500 && config.isProduction ? "Internal server error" : error.message
      }
    });
  };
}
