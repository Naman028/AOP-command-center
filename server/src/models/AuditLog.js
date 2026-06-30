import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, index: true },
    entityType: { type: String },
    entityId: { type: String },
    plantId: { type: String },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    requestId: { type: String, index: true },
    ipHash: { type: String },
    userAgentHash: { type: String },
    timestamp: { type: Date, default: Date.now, index: true }
  },
  { versionKey: false }
);

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model("AuditLog", auditLogSchema);
