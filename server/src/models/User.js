import mongoose from "mongoose";
import { ROLES } from "../constants/permissions.js";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(ROLES), required: true },
    assignedPlants: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const User = mongoose.models.User ?? mongoose.model("User", userSchema);
