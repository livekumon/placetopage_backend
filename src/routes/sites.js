import { Router } from "express";
import mongoose from "mongoose";
import { Site } from "../models/Site.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { generateSiteHtml } from "../services/htmlGenerator.js";
import { deployToVercel, addCustomDomain } from "../services/vercelDeploy.js";

const DOMAIN_BASE = process.env.CUSTOM_DOMAIN_BASE || "placetopage.com";

const router = Router();

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Validate subdomain: lowercase letters, numbers, hyphens; no leading/trailing hyphens
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

// ── GET /check-subdomain?subdomain=xxx ───────────────────────────────────────
router.get("/check-subdomain", requireAuth, async (req, res, next) => {
  try {
    const raw = String(req.query.subdomain || "").toLowerCase().trim();
    if (!raw) return res.status(400).json({ message: "subdomain is required" });
    if (!SUBDOMAIN_RE.test(raw)) {
      return res.json({
        available: false,
        subdomain: raw,
        fullDomain: `${raw}.${DOMAIN_BASE}`,
        reason: "Only lowercase letters, numbers, and hyphens are allowed.",
      });
    }
    const taken = await Site.exists({ customSubdomain: raw });
    res.json({
      available: !taken,
      subdomain: raw,
      fullDomain: `${raw}.${DOMAIN_BASE}`,
      domainBase: DOMAIN_BASE,
      reason: taken ? "This subdomain is already taken." : null,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/stats", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(401).json({ message: "User not found" });

    const sites = await Site.find({ userId: req.userId }).lean();
    const totalSites = sites.length;
    const pageViewsTotal = sites.reduce((acc, s) => acc + (s.pageViews || 0), 0);
    const firstName = (user.name || user.email || "there").split(/\s+/)[0];

    res.json({
      totalSites,
      pageViewsTotal,
      ctaClicks: 842,
      creditsRemaining: user.creditsRemaining,
      displayName: firstName,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const sites = await Site.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json(sites);
  } catch (e) {
    next(e);
  }
});

// ── POST / — generate HTML + save draft (no Vercel deploy yet) ───────────────
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.creditsRemaining < 1) {
      return res.status(402).json({ message: "No credits remaining" });
    }

    const { name, mapsUrl, category, thumbnailUrl, theme, slug: bodySlug, placeData } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });

    let slug = bodySlug ? slugify(bodySlug) : slugify(name);
    let unique = slug;
    let n = 0;
    while (await Site.exists({ slug: unique })) {
      n += 1;
      unique = `${slug}-${n}`;
    }

    // Generate the HTML and store it — do NOT deploy yet
    const html = generateSiteHtml({
      name,
      theme: theme || "light",
      placeData: {
        ...(placeData || {}),
        mapsUrl,
        category: category || "Business",
        photoUrl: thumbnailUrl || placeData?.photoUrl,
      },
    });

    const site = await Site.create({
      userId: req.userId,
      name,
      slug: unique,
      subdomain: `${unique}.placetopage.app`,
      mapsUrl,
      category: category || "Business",
      thumbnailUrl,
      theme: theme || "light",
      status: "draft",
      pageViews: 0,
      generatedHtml: html,
      placeData: placeData || null,
    });

    user.creditsRemaining -= 1;
    await user.save();

    // Return site + the HTML so the frontend can render a preview iframe
    res.status(201).json({ ...site.toObject(), generatedHtml: html });
  } catch (e) {
    next(e);
  }
});

// ── POST /:id/deploy — push the stored HTML to Vercel ────────────────────────
router.post("/:id/deploy", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findById(req.params.id);
    if (!site || String(site.userId) !== String(req.userId)) {
      return res.status(404).json({ message: "Site not found" });
    }
    if (!site.generatedHtml) {
      return res.status(400).json({ message: "No generated HTML found for this site." });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) {
      return res.status(503).json({ message: "VERCEL_TOKEN is not configured on the server." });
    }

    // Validate + claim the chosen subdomain
    const chosenSubdomain = String(req.body.subdomain || "").toLowerCase().trim();
    if (chosenSubdomain) {
      if (!SUBDOMAIN_RE.test(chosenSubdomain)) {
        return res.status(400).json({ message: "Invalid subdomain format." });
      }
      const conflict = await Site.findOne({
        customSubdomain: chosenSubdomain,
        _id: { $ne: site._id },
      });
      if (conflict) {
        return res.status(409).json({
          message: `The subdomain "${chosenSubdomain}.${DOMAIN_BASE}" is already taken.`,
          code: "SUBDOMAIN_TAKEN",
        });
      }
    }

    // Deploy to Vercel
    const deployment = await deployToVercel({
      name: site.name,
      html: site.generatedHtml,
      token: vercelToken,
    });

    // Attach custom domain (e.g. biryani-blues.placetopage.com) to the Vercel project
    let liveUrl = deployment.url;
    if (chosenSubdomain) {
      const customDomain = `${chosenSubdomain}.${DOMAIN_BASE}`;
      const domainResult = await addCustomDomain({
        projectName: deployment.projectName,
        domain: customDomain,
        token: vercelToken,
      });
      if (domainResult?.ok) {
        liveUrl = `https://${customDomain}`;
        console.log(`Custom domain assigned: ${liveUrl}`);
      } else {
        console.warn(`Custom domain assignment failed — using Vercel URL: ${liveUrl}`);
      }
    }

    site.customSubdomain = chosenSubdomain || null;
    site.deploymentUrl = liveUrl;
    site.vercelDeploymentId = deployment.deploymentId;
    site.vercelProjectName = deployment.projectName;
    site.subdomain = liveUrl;
    site.status = "live";
    await site.save();

    console.log(`Deployed: ${liveUrl}`);
    res.json({ ...site.toObject(), domainBase: DOMAIN_BASE });
  } catch (e) {
    next(e);
  }
});

router.get("/:idOrSlug", async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    let doc = null;
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      doc = await Site.findById(idOrSlug).lean();
    }
    if (!doc) doc = await Site.findOne({ slug: idOrSlug }).lean();
    if (!doc) return res.status(404).json({ message: "Site not found" });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findById(req.params.id);
    if (!site || String(site.userId) !== String(req.userId)) {
      return res.status(404).json({ message: "Site not found" });
    }
    Object.assign(site, req.body);
    await site.save();
    res.json(site);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findById(req.params.id);
    if (!site || String(site.userId) !== String(req.userId)) {
      return res.status(404).json({ message: "Site not found" });
    }
    await site.deleteOne();
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
