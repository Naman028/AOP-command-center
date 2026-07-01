import mongoose from "mongoose";

const importBatchSchema = new mongoose.Schema(
  {
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileNameSafe: { type: String, required: true },
    fileSha256: { type: String, required: true },
    templateVersion: { type: String, required: true, default: "actual-import-v1" },
    status: { type: String, enum: ["PREVIEWED", "CONFIRMING", "IMPORTED", "REJECTED", "FAILED", "EXPIRED"], required: true },
    totalRows: { type: Number, required: true },
    validRows: { type: Number, required: true },
    invalidRows: { type: Number, required: true },
    stagedRows: [{ type: mongoose.Schema.Types.Mixed }],
    validationErrors: [{ type: mongoose.Schema.Types.Mixed }],
    permittedPlantIds: [{ type: String }],
    confirmedAt: { type: Date },
    importedAt: { type: Date },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

importBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
importBatchSchema.index({ uploadedBy: 1, createdAt: -1 });
importBatchSchema.index({ status: 1, createdAt: -1 });
importBatchSchema.index({ permittedPlantIds: 1, createdAt: -1 });

export const ImportBatch = mongoose.models.ImportBatch ?? mongoose.model("ImportBatch", importBatchSchema);
