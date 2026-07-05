import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    entityType: { type: String, index: true },
    entityId: { type: String },
    reportType: { type: String },
    filters: { type: mongoose.Schema.Types.Mixed },
    permittedPlantScope: [{ type: String }],
    plantId: { type: String },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    requestId: { type: String },
    ipHash: { type: String },
    userAgentHash: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ plantId: 1, createdAt: -1 });
auditLogSchema.index({ requestId: 1 });

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model("AuditLog", auditLogSchema);
