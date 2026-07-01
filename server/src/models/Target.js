import mongoose from "mongoose";

const targetSchema = new mongoose.Schema(
  {
    plant: { type: mongoose.Schema.Types.ObjectId, ref: "Plant", required: true, index: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    metricType: { type: String, enum: ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"], required: true, index: true },
    category: { type: String, required: true, trim: true, uppercase: true, default: "TOTAL" },
    material: { type: mongoose.Schema.Types.ObjectId, ref: "Material", default: null },
    plannedValue: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

targetSchema.index({ plant: 1, financialYear: 1, month: 1, metricType: 1, category: 1, material: 1 }, { unique: true });
targetSchema.index({ financialYear: 1, plant: 1, isActive: 1, metricType: 1, month: 1 });

export const Target = mongoose.models.Target ?? mongoose.model("Target", targetSchema);
