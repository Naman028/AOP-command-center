import mongoose from "mongoose";

const materialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    category: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

materialSchema.index({ code: 1 }, { unique: true });
materialSchema.index({ isActive: 1, category: 1 });

export const Material = mongoose.models.Material ?? mongoose.model("Material", materialSchema);
