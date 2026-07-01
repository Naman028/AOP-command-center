import mongoose from "mongoose";

const actualSchema = new mongoose.Schema(
  {
    plant: { type: mongoose.Schema.Types.ObjectId, ref: "Plant", required: true, index: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    metricType: { type: String, enum: ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"], required: true, index: true },
    category: { type: String, required: true, trim: true, uppercase: true, default: "TOTAL" },
    material: { type: mongoose.Schema.Types.ObjectId, ref: "Material", default: null },
    actualValue: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    source: { type: String, enum: ["MANUAL", "EXCEL_IMPORT"], required: true, default: "MANUAL" },
    importBatch: { type: mongoose.Schema.Types.ObjectId, ref: "ImportBatch" },
    notes: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

actualSchema.index({ plant: 1, financialYear: 1, month: 1, metricType: 1, category: 1, material: 1 }, { unique: true });

export const Actual = mongoose.models.Actual ?? mongoose.model("Actual", actualSchema);
