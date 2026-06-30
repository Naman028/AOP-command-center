import mongoose from "mongoose";

const importBatchSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    originalName: { type: String, required: true },
    tempName: { type: String, required: true },
    status: { type: String, enum: ["PREVIEWED", "CONFIRMED", "FAILED"], required: true },
    rowCount: { type: Number, required: true },
    errorCount: { type: Number, required: true },
    plantIds: [{ type: String }]
  },
  { timestamps: true }
);

export const ImportBatch = mongoose.models.ImportBatch ?? mongoose.model("ImportBatch", importBatchSchema);
