import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb } from "./config/db.js";
import sitesRouter from "./routes/sites.js";
import authRouter from "./routes/auth.js";
import mapsRouter from "./routes/maps.js";
import enrichRouter from "./routes/enrich.js";
import paymentsRouter from "./routes/payments.js";
import uploadRouter from "./routes/upload.js";
import adminRouter from "./routes/admin.js";
import { seedIfEmpty } from "./seed.js";
import { promoteAdminUsers } from "./services/promoteAdmins.js";

const PORT = Number(process.env.PORT) || 8080;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/placetowebsite";

// Default origins include both local dev and the deployed Vercel frontend.
// Override at runtime by setting CORS_ORIGINS=url1,url2 in the environment.
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://placetopage-frontend.vercel.app",
    ];

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      // Local dev: Vite may use localhost vs 127.0.0.1 or a different port; .env duplicates can drop one origin
      if (!process.env.VERCEL && origin) {
        try {
          const { hostname } = new URL(origin);
          if (hostname === "localhost" || hostname === "127.0.0.1") {
            return cb(null, true);
          }
        } catch {
          /* ignore */
        }
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json());

// Ensure DB is connected before every request (safe for serverless cold starts)
let adminPromoteDone = false;
app.use(async (_req, _res, next) => {
  try {
    await connectDb(MONGODB_URI);
    if (!adminPromoteDone) {
      adminPromoteDone = true;
      try {
        await promoteAdminUsers();
      } catch (e) {
        console.error("promoteAdminUsers:", e);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "place-to-page-api" });
});

// Public — PayPal JS SDK needs the same client ID as the server (safe to expose)
app.get("/api/paypal/client-id", (_req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID || "" });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/sites", sitesRouter);
app.use("/api/maps", mapsRouter);
app.use("/api/enrich", enrichRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/upload", uploadRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.message?.startsWith("CORS:") ? 403 : 500;
  res.status(status).json({ message: err.message || "Server error" });
});

// ── Local dev: start HTTP server ──────────────────────────────────────────────
// On Vercel the app is exported as a serverless function; listen is skipped.
if (!process.env.VERCEL) {
  connectDb(MONGODB_URI)
    .then(() => seedIfEmpty())
    .then(() => {
      app.listen(PORT, "0.0.0.0", () =>
        console.log(`API listening on 0.0.0.0:${PORT}`)
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// ── Vercel serverless export ──────────────────────────────────────────────────
export default app;
