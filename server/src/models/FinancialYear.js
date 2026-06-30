import mongoose from "mongoose";

const financialYearSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

financialYearSchema.path("endDate").validate(function validateEndDate(value) {
  return this.startDate < value;
}, "endDate must be after startDate");

financialYearSchema.index({ label: 1 }, { unique: true });
financialYearSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export const FinancialYear = mongoose.models.FinancialYear ?? mongoose.model("FinancialYear", financialYearSchema);
