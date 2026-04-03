/**
 * Fixes E11000 duplicate key on googleId: null
 *
 * What it does:
 *  1. Unsets googleId on all users where it is null or "" (email/password users)
 *  2. Drops the old googleId_1 unique index
 *  3. Syncs the new partial unique index from the User schema
 *
 * Usage (from backend/):
 *   MONGODB_URI=<uri> node scripts/fix-google-id-index.js
 *   or: npm run fix:google-id-index
 */

import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../src/models/User.js";
import { connectDb } from "../src/config/db.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI in the environment or .env");
  process.exit(1);
}

await connectDb(uri);
const col = mongoose.connection.collection("users");

// Step 1 — unset null/empty googleId from existing documents
const unsetRes = await col.updateMany(
  { $or: [{ googleId: null }, { googleId: "" }] },
  { $unset: { googleId: "" } }
);
console.log(
  `Unset googleId on ${unsetRes.modifiedCount} document(s) (matched ${unsetRes.matchedCount}).`
);

// Step 2 — drop the old broken index
try {
  await col.dropIndex("googleId_1");
  console.log("Dropped index googleId_1.");
} catch (e) {
  console.warn("Could not drop googleId_1 (may not exist):", e.message);
}

// Step 3 — sync the new partial unique index from the schema
await User.syncIndexes();
console.log("User indexes synced.");

const indexes = await col.indexes();
console.log("Indexes on users:", indexes.map((i) => i.name).join(", "));

await mongoose.disconnect();
console.log("Done. Registration and Google Sign-In will now work for multiple users.");
