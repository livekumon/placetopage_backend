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
        vercelProjectId: { type: String, default: null },
        vercelProjectName: { type: String, default: null },
        generatedHtml: { type: String, default: null },
        placeData: { type: mongoose.Schema.Types.Mixed, default: null },
        // Slug-only portion of the custom domain, e.g. "biryani-blues"
        // Full URL = customSubdomain + "." + CUSTOM_DOMAIN_BASE
        // Do not store null — MongoDB unique indexes count null as a value. Omit the field when unused.
        customSubdomain: {
          type: String,
          lowercase: true,
          trim: true,
        },
        /** Set when user removes an archived site from the dashboard (row kept in DB) */
        deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

// Unique only for real strings — $type:"string" is supported by all MongoDB versions
// and naturally excludes null, missing, and "" (empty strings are type string but filtered by app logic).
siteSchema.index(
  { customSubdomain: 1 },
  {
    unique: true,
    partialFilterExpression: {
      customSubdomain: { $exists: true, $type: "string" },
    },
  }
);

export const Site = mongoose.model("Site", siteSchema);
