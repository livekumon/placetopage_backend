import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Google SSO users — no default so the field is absent for email/password users
    // Uniqueness enforced via partial index below (only when field exists and is non-null)
    googleId: { type: String },

    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    picture: { type: String, default: "" },

    // Email/password users — absent for Google-only accounts
    passwordHash: { type: String },

    creditsRemaining: { type: Number, default: 1240 },
    /** One "Go Live" PayPal purchase adds credits; each deploy consumes one */
    publishingCredits: { type: Number, default: 0 },

    /** Can open GET /api/admin/metrics with a normal user JWT (e.g. Google SSO) */
    isAdmin: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Partial unique index — only enforces uniqueness when googleId actually has a value.
// Email/password users have no googleId field at all, so they are excluded entirely.
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      googleId: { $exists: true, $type: "string" },
    },
  }
);

export const User = mongoose.model("User", userSchema);
