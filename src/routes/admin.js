import crypto from "crypto";
import { Router } from "express";
import { User } from "../models/User.js";
import { Site } from "../models/Site.js";
import { Payment } from "../models/Payment.js";
import { requireAdminAccess, signAdminToken } from "../middleware/auth.js";
import { getLoginEventsTotal } from "../services/appStats.js";

const router = Router();

const siteVisible = { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };

function adminConfigured() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  return Boolean(email && password);
}

function verifyAdminPassword(plain, expectedFromEnv) {
  if (expectedFromEnv == null || plain == null) return false;
  const a = crypto.createHash("sha256").update(String(plain), "utf8").digest();
  const b = crypto.createHash("sha256").update(String(expectedFromEnv), "utf8").digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post("/login", (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({
      message:
        "Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server.",
    });
  }

  const expectedEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const invalid = () => res.status(401).json({ message: "Invalid email or password." });

  if (email !== expectedEmail) return invalid();
  if (!verifyAdminPassword(password, process.env.ADMIN_PASSWORD)) return invalid();

  res.json({ token: signAdminToken() });
});

router.get("/metrics", requireAdminAccess, async (_req, res, next) => {
  try {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86400000);
    const d30 = new Date(now.getTime() - 30 * 86400000);

    const [
      usersTotal,
      usersLast7d,
      usersLast30d,
      totalLoginEvents,
      sitesTotal,
      sitesDraft,
      sitesLive,
      sitesArchived,
      sitesLast7d,
      paymentsCompletedCount,
      paymentsCompletedSum,
      paymentsByStatus,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: d7 } }),
      User.countDocuments({ createdAt: { $gte: d30 } }),
      getLoginEventsTotal(),
      Site.countDocuments(siteVisible),
      Site.countDocuments({ status: "draft", ...siteVisible }),
      Site.countDocuments({ status: "live", ...siteVisible }),
      Site.countDocuments({ status: "archived", ...siteVisible }),
      Site.countDocuments({ createdAt: { $gte: d7 }, ...siteVisible }),
      Payment.countDocuments({ status: "completed" }),
      Payment.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, totalUsd: { $sum: "$amount" } } },
      ]),
      Payment.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalPurchasesUsd = paymentsCompletedSum[0]?.totalUsd ?? 0;

    res.json({
      generatedAt: now.toISOString(),
      users: {
        total: usersTotal,
        registeredLast7Days: usersLast7d,
        registeredLast30Days: usersLast30d,
      },
      logins: {
        /** Successful sign-ins recorded since this feature was deployed */
        totalEvents: totalLoginEvents,
      },
      sites: {
        total: sitesTotal,
        draft: sitesDraft,
        live: sitesLive,
        archived: sitesArchived,
        createdLast7Days: sitesLast7d,
      },
      purchases: {
        completedCount: paymentsCompletedCount,
        completedRevenueUsd: Math.round(totalPurchasesUsd * 100) / 100,
        byStatus: paymentsByStatus.map((r) => ({ status: r._id, count: r.count })),
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
