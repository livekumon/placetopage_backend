import { Router } from "express";
import mongoose from "mongoose";
import { Site } from "../models/Site.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { generateSiteHtml, generateLinkedInSiteHtml } from "../services/htmlGenerator.js";

function buildHtml(siteType, name, theme, body) {
  if (siteType === "linkedin") {
    return generateLinkedInSiteHtml({ name, ...(body.placeData || {}) }, theme || "light");
  }
  return generateSiteHtml({
    name,
    theme: theme || "light",
    placeData: {
      ...(body.placeData || {}),
      mapsUrl: body.mapsUrl,
      category: body.category || "Business",
      photoUrl: body.thumbnailUrl || body.placeData?.photoUrl,
    },
  });
}
import {
  deployToVercel,
  addCustomDomain,
  resolveVercelProjectFromDeployment,
  pauseVercelProjectForSite,
  unpauseVercelProjectForSite,
} from "../services/vercelDeploy.js";
import { SUBDOMAIN_RE } from "../utils/subdomainSlug.js";

const DOMAIN_BASE = process.env.CUSTOM_DOMAIN_BASE || "placetopage.com";

const router = Router();

/** Sites visible on the dashboard and editable (not soft-deleted) */
function notDeletedFilter() {
  return { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] };
}

/** True if the site is / was published and may have a public URL (Vercel / custom domain). */
function siteHasPublicWebFootprint(site) {
  if (!site) return false;
  const st = String(site.status || "").toLowerCase();
  if (st === "live") return true;
  const sub = typeof site.subdomain === "string" ? site.subdomain.trim() : "";
  if (sub.startsWith("http")) return true;
  return Boolean(
    site.deploymentUrl?.trim() ||
      site.customSubdomain?.trim() ||
      site.vercelDeploymentId?.trim() ||
      site.vercelProjectId?.trim()
  );
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
    const exceptRaw = String(req.query.exceptSiteId || "").trim();
    const exceptIdOk = mongoose.Types.ObjectId.isValid(exceptRaw);
    const taken = await Site.exists({
      customSubdomain: raw,
      ...notDeletedFilter(),
      ...(exceptIdOk ? { _id: { $ne: exceptRaw } } : {}),
    });
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

    const sites = await Site.find({ userId: req.userId, ...notDeletedFilter() }).lean();
    const totalSites = sites.length;
    const pageViewsTotal = sites.reduce((acc, s) => acc + (s.pageViews || 0), 0);
    const firstName = (user.name || user.email || "there").split(/\s+/)[0];

    res.json({
      totalSites,
      pageViewsTotal,
      ctaClicks: 842,
      creditsRemaining: user.creditsRemaining,
      publishingCredits: user.publishingCredits ?? 0,
      displayName: firstName,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const sites = await Site.find({ userId: req.userId, ...notDeletedFilter() })
      .sort({ createdAt: -1 })
      .lean();
    res.json(sites);
  } catch (e) {
    next(e);
  }
});

// ── GET /mine/:id — authenticated owner only (must be before GET /:idOrSlug) ─
router.get("/mine/:id", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findOne({
      _id: req.params.id,
      userId: req.userId,
      ...notDeletedFilter(),
    }).lean();
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }
    res.json(site);
  } catch (e) {
    next(e);
  }
});

// ── GET /recycle-bin — soft-deleted sites (must be before GET /:idOrSlug) ─────
router.get("/recycle-bin", requireAuth, async (req, res, next) => {
  try {
    const sites = await Site.find({
      userId: req.userId,
      deletedAt: { $ne: null },
    })
      .sort({ deletedAt: -1 })
      .lean();
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

    const { name, mapsUrl, category, thumbnailUrl, theme, slug: bodySlug, placeData, siteType } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });

    let slug = bodySlug ? slugify(bodySlug) : slugify(name);
    let unique = slug;
    let n = 0;
    while (await Site.exists({ slug: unique, ...notDeletedFilter() })) {
      n += 1;
      unique = `${slug}-${n}`;
    }

    // Generate the HTML and store it — do NOT deploy yet
    const html = buildHtml(siteType, name, theme, req.body);

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
      siteType: siteType === "linkedin" ? "linkedin" : "maps",
    });

    user.creditsRemaining -= 1;
    await user.save();

    // Return site + the HTML so the frontend can render a preview iframe
    res.status(201).json({ ...site.toObject(), generatedHtml: html });
  } catch (e) {
    next(e);
  }
});

// ── POST /preview — render HTML without saving (editor live preview) ─────────
router.post("/preview", requireAuth, async (req, res, next) => {
  try {
    const { name, theme, mapsUrl, category, thumbnailUrl, placeData, siteType } = req.body;
    const safeTheme = ["light", "dark", "bold"].includes(theme) ? theme : "light";
    const html = buildHtml(siteType, name || "Untitled", safeTheme, {
      mapsUrl, category: category || "Business",
      thumbnailUrl: thumbnailUrl || placeData?.photoUrl,
      placeData: placeData && typeof placeData === "object" ? placeData : {},
    });
    res.json({ html });
  } catch (e) {
    next(e);
  }
});

// ── POST /recycle-bin/:id/restore — undo soft delete (before POST /:id/deploy) ─
router.post("/recycle-bin/:id/restore", requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid site id" });
    }
    const site = await Site.findOne({
      _id: id,
      userId: req.userId,
      deletedAt: { $ne: null },
    });
    if (!site) {
      return res.status(404).json({ message: "Site not found in recycle bin" });
    }
    site.deletedAt = null;
    await site.save();

    const vercelToken = process.env.VERCEL_TOKEN;
    const canUnpause =
      vercelToken &&
      (site.vercelProjectId?.trim() || site.vercelDeploymentId?.trim());
    if (canUnpause) {
      const up = await unpauseVercelProjectForSite({
        projectId: site.vercelProjectId,
        deploymentId: site.vercelDeploymentId,
        token: vercelToken,
      });
      if (!up.ok) {
        console.warn("Vercel unpause on restore:", up.error);
      }
    }

    res.json(site.toObject());
  } catch (e) {
    next(e);
  }
});

// ── POST /:id/deploy — push the stored HTML to Vercel ────────────────────────
router.post("/:id/deploy", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findOne({ _id: req.params.id, userId: req.userId, ...notDeletedFilter() });
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }
    if (!site.generatedHtml) {
      return res.status(400).json({ message: "No generated HTML found for this site." });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ message: "User not found" });

    const skipPayment = process.env.SKIP_PUBLISH_PAYMENT === "true";
    if (!skipPayment && (user.publishingCredits || 0) < 1) {
      return res.status(402).json({
        message:
          "You need at least one website credit to publish. Purchase a credit starting from $5.",
        code: "PUBLISHING_CREDITS_REQUIRED",
      });
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
        ...notDeletedFilter(),
      });
      if (conflict) {
        return res.status(409).json({
          message: `The subdomain "${chosenSubdomain}.${DOMAIN_BASE}" is already taken.`,
          code: "SUBDOMAIN_TAKEN",
        });
      }
    }

    // Reuse the same Vercel project when this site was already published so new
    // deployments update production on that project (not a new project), e.g.
    // after renaming the site in our app.
    let targetProjectId = site.vercelProjectId?.trim() || null;
    let targetProjectName = site.vercelProjectName?.trim() || null;
    if ((!targetProjectId || !targetProjectName) && site.vercelDeploymentId) {
      const resolved = await resolveVercelProjectFromDeployment(
        site.vercelDeploymentId,
        vercelToken
      );
      if (!targetProjectId && resolved.projectId) targetProjectId = resolved.projectId;
      if (!targetProjectName && resolved.projectName) targetProjectName = resolved.projectName;
    }

    const deployment = await deployToVercel({
      name: site.name,
      html: site.generatedHtml,
      token: vercelToken,
      targetProjectId,
      targetProjectName,
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

    if (chosenSubdomain) {
      site.customSubdomain = chosenSubdomain;
    } else {
      site.set("customSubdomain", undefined);
    }
    site.deploymentUrl = liveUrl;
    site.vercelDeploymentId = deployment.deploymentId;
    if (deployment.projectId) site.vercelProjectId = deployment.projectId;
    site.vercelProjectName = deployment.projectName;
    site.subdomain = liveUrl;
    site.status = "live";
    await site.save();

    if (!skipPayment) {
      user.publishingCredits = Math.max(0, (user.publishingCredits || 0) - 1);
      await user.save();
    }

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
      doc = await Site.findOne({ _id: idOrSlug, ...notDeletedFilter() }).lean();
    }
    if (!doc) doc = await Site.findOne({ slug: idOrSlug, ...notDeletedFilter() }).lean();
    if (!doc) return res.status(404).json({ message: "Site not found" });
    res.json(doc);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findOne({ _id: req.params.id, userId: req.userId, ...notDeletedFilter() });
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }

    const previousStatus = String(site.status || "").toLowerCase();
    const hadPublicFootprintBefore = siteHasPublicWebFootprint(site);

    const {
      name,
      mapsUrl,
      category,
      thumbnailUrl,
      theme,
      placeData: bodyPlaceData,
      status: bodyStatus,
      customSubdomain: bodyCustomSubdomain,
    } = req.body;

    if (bodyCustomSubdomain !== undefined) {
      const raw = String(bodyCustomSubdomain ?? "").toLowerCase().trim();
      if (!raw) {
        site.set("customSubdomain", undefined);
      } else {
        if (!SUBDOMAIN_RE.test(raw)) {
          return res.status(400).json({ message: "Invalid subdomain format." });
        }
        const conflict = await Site.findOne({
          customSubdomain: raw,
          _id: { $ne: site._id },
          ...notDeletedFilter(),
        });
        if (conflict) {
          return res.status(409).json({
            message: `The subdomain "${raw}.${DOMAIN_BASE}" is already taken. Choose a different one.`,
            code: "SUBDOMAIN_TAKEN",
          });
        }
        site.customSubdomain = raw;
      }
    }

    if (bodyStatus !== undefined) {
      const s = String(bodyStatus).toLowerCase();
      if (["draft", "live", "archived"].includes(s)) {
        site.status = s;
      }
    }

    if (name !== undefined) site.name = String(name).trim() || site.name;
    if (mapsUrl !== undefined) site.mapsUrl = String(mapsUrl).trim();
    if (category !== undefined) site.category = String(category).trim() || site.category;
    if (thumbnailUrl !== undefined) site.thumbnailUrl = String(thumbnailUrl).trim() || null;
    if (theme !== undefined && ["light", "dark", "bold"].includes(theme)) {
      site.theme = theme;
    }

    if (bodyPlaceData && typeof bodyPlaceData === "object" && !Array.isArray(bodyPlaceData)) {
      site.placeData = { ...(site.placeData || {}), ...bodyPlaceData };
    }

    const pd = site.placeData || {};
    const html = buildHtml(site.siteType, site.name, site.theme, {
      mapsUrl: site.mapsUrl,
      category: site.category || "Business",
      thumbnailUrl: site.thumbnailUrl,
      placeData: { ...pd },
    });
    site.generatedHtml = html;

    await site.save();

    const newStatus = String(site.status || "").toLowerCase();
    const becameArchived = newStatus === "archived" && previousStatus !== "archived";

    const out = site.toObject();
    if (becameArchived && hadPublicFootprintBefore) {
      const vercelToken = process.env.VERCEL_TOKEN;
      let vercelPauseWarning = null;
      let vercelPaused = false;
      if (vercelToken) {
        const pauseResult = await pauseVercelProjectForSite({
          projectId: site.vercelProjectId,
          deploymentId: site.vercelDeploymentId,
          token: vercelToken,
        });
        if (pauseResult.ok) {
          vercelPaused = true;
        } else {
          vercelPauseWarning = pauseResult.error || "Could not pause the site on Vercel.";
          console.warn("Vercel pause on archive:", vercelPauseWarning);
        }
      } else {
        vercelPauseWarning =
          "Server is not configured to reach Vercel; the public URL may still be reachable until the project is paused manually.";
      }
      out.vercelPaused = vercelPaused;
      if (vercelPauseWarning) out.vercelPauseWarning = vercelPauseWarning;
    }

    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const site = await Site.findOne({ _id: req.params.id, userId: req.userId, ...notDeletedFilter() });
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }
    if (site.status !== "archived") {
      return res.status(400).json({
        message: "Only archived sites can be removed from your dashboard. Archive the site first.",
      });
    }

    const hadPublicPublishing = siteHasPublicWebFootprint(site);

    const vercelToken = process.env.VERCEL_TOKEN;
    let vercelPauseWarning = null;
    let vercelPaused = false;

    if (hadPublicPublishing && vercelToken) {
      const pauseResult = await pauseVercelProjectForSite({
        projectId: site.vercelProjectId,
        deploymentId: site.vercelDeploymentId,
        token: vercelToken,
      });
      if (pauseResult.ok) {
        vercelPaused = true;
      } else {
        vercelPauseWarning = pauseResult.error || "Could not pause the site on Vercel.";
        console.warn("Vercel pause on site delete:", vercelPauseWarning);
      }
    } else if (hadPublicPublishing && !vercelToken) {
      vercelPauseWarning =
        "Server is not configured to reach Vercel; the public URL may still be reachable until the project is paused manually.";
    }

    site.deletedAt = new Date();
    await site.save();

    res.status(200).json({
      ok: true,
      vercelPaused,
      vercelPauseWarning: vercelPauseWarning || undefined,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
