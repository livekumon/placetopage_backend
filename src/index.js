import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb } from "./config/db.js";
import sitesRouter from "./routes/sites.js";
import authRouter from "./routes/auth.js";
import mapsRouter from "./routes/maps.js";
import enrichRouter from "./routes/enrich.js";
import { seedIfEmpty } from "./seed.js";

const PORT = Number(process.env.PORT) || 8080;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/placetowebsite";

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5173", "http://127.0.0.1:5173"];

const app = express();
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "place-to-page-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/sites", sitesRouter);
app.use("/api/maps", mapsRouter);
app.use("/api/enrich", enrichRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Server error" });
});

async function main() {
  await connectDb(MONGODB_URI);
  await seedIfEmpty();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on 0.0.0.0:${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
