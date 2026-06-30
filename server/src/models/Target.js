import mongoose from "mongoose";

const targetSchema = new mongoose.Schema(
  {
    plantId: { type: String, required: true, index: true },
    financialYear: { type: String, required: true },
    metricType: { type: String, enum: ["output", "cost", "efficiency"], required: true },
    value: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

targetSchema.index({ plantId: 1, financialYear: 1, metricType: 1 }, { unique: true });

export const Target = mongoose.models.Target ?? mongoose.model("Target", targetSchema);
