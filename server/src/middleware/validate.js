import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { containsUnsafeMongoOperator } from "../utils/sanitize.js";

export function rejectUnsafeInput(req, _res, next) {
  if (containsUnsafeMongoOperator(req.body) || containsUnsafeMongoOperator(req.query) || containsUnsafeMongoOperator(req.params)) {
    next(new HttpError(400, "Unsafe query operator rejected", "UNSAFE_INPUT"));
    return;
  }
  next();
}

export function validateObjectIdParam(paramName) {
  return (req, _res, next) => {
    const value = req.params[paramName];
    if (value && !mongoose.isValidObjectId(value)) {
      next(new HttpError(400, "Invalid identifier", "INVALID_OBJECT_ID"));
      return;
    }
    next();
  };
}

export function validateSchema(schema, source = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new HttpError(400, "Validation failed", "VALIDATION_FAILED"));
      return;
    }
    if (source === "query") {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
}
