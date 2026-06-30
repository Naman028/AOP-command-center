import { v4 as uuidv4 } from "uuid";

export function requestContext(req, res, next) {
  req.id = req.get("x-request-id") || uuidv4();
  res.setHeader("X-Request-ID", req.id);
  next();
}
