import mongoose from "mongoose";

const plantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    location: { type: String, required: true, trim: true },
    businessUnit: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

plantSchema.index({ code: 1 }, { unique: true });
plantSchema.index({ isActive: 1, businessUnit: 1 });

export const Plant = mongoose.models.Plant ?? mongoose.model("Plant", plantSchema);
