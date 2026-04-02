import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Google SSO users — sparse so multiple null values don't conflict
    googleId: { type: String, default: null, index: { unique: true, sparse: true } },

    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    picture: { type: String, default: "" },

    // Email/password users — null for Google-only accounts
    passwordHash: { type: String, default: null },

    creditsRemaining: { type: Number, default: 1240 },
    /** One "Go Live" PayPal purchase adds credits; each deploy consumes one */
    publishingCredits: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
