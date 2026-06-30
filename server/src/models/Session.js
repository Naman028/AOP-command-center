import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash: { type: String, required: true },
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
    ipHash: { type: String },
    userAgentHash: { type: String }
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, revokedAt: 1 });

export const Session = mongoose.models.Session ?? mongoose.model("Session", sessionSchema);
