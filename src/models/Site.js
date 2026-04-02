import mongoose from "mongoose";

const siteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    subdomain: { type: String },
    category: { type: String, default: "Business" },
        mapsUrl: { type: String },
        thumbnailUrl: { type: String },
        pageViews: { type: Number, default: 0 },
        status: {
          type: String,
          enum: ["draft", "live", "archived"],
          default: "draft",
        },
        theme: { type: String, default: "light" },
        deploymentUrl: { type: String, default: null },
        vercelDeploymentId: { type: String, default: null },
        vercelProjectName: { type: String, default: null },
        generatedHtml: { type: String, default: null },
        placeData: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const Site = mongoose.model("Site", siteSchema);
