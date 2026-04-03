import mongoose from "mongoose";

const appStatsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    /** Successful sign-ins (email password, Google login, or Google on existing account) */
    totalLoginEvents: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const AppStats = mongoose.model("AppStats", appStatsSchema);
