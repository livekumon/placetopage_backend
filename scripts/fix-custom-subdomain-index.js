/**
 * Fixes E11000 duplicate key on customSubdomain: null — drops the old unique index,
 * unsets null/empty customSubdomain values, and syncs the partial unique index from Site schema.
 *
 * Usage:  MONGODB_URI=... node scripts/fix-custom-subdomain-index.js
 * Or from backend/:  npm run fix:subdomain-index
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Site } from "../src/models/Site.js";
import { connectDb } from "../src/config/db.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI in the environment or .env");
  process.exit(1);
}

await connectDb(uri);
const col = mongoose.connection.collection("sites");

const unsetRes = await col.updateMany(
  { $or: [{ customSubdomain: null }, { customSubdomain: "" }] },
  { $unset: { customSubdomain: "" } }
);
console.log(`Unset customSubdomain on ${unsetRes.modifiedCount} document(s) (matched ${unsetRes.matchedCount}).`);

try {
  await col.dropIndex("customSubdomain_1");
  console.log("Dropped index customSubdomain_1.");
} catch (e) {
  console.warn("Could not drop customSubdomain_1 (may not exist):", e.message);
}

await Site.syncIndexes();
console.log("Site indexes synced.");
const indexes = await col.indexes();
console.log(
  "Indexes on sites:",
  indexes.map((i) => i.name).join(", ")
);

await mongoose.disconnect();
console.log("Done.");
