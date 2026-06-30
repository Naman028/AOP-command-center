export class HttpError extends Error {
  constructor(status, message, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function unauthorized(message = "Authentication required") {
  return new HttpError(401, message, "UNAUTHORIZED");
}

export function forbidden(message = "Forbidden") {
  return new HttpError(403, message, "FORBIDDEN");
}
