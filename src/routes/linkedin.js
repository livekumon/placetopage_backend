import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";
import { slugFromLLMSubdomainWords } from "../utils/subdomainSlug.js";

const router = Router();

// ── LinkedIn URL parsing ───────────────────────────────────────────────────────

/**
 * Extract the LinkedIn username/ID from various LinkedIn URL formats:
 *  - https://www.linkedin.com/in/username
 *  - https://linkedin.com/in/username/
 *  - http://linkedin.com/in/username?param=value
 *  - linkedin.com/in/username
 */
function parseLinkedInUrl(url) {
  const cleaned = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const match = cleaned.match(/^linkedin\.com\/in\/([a-zA-Z0-9_%-]+)/i);
  if (!match) return null;
  return decodeURIComponent(match[1].replace(/\/$/, ""));
}

/**
 * Validate that a URL looks like a LinkedIn profile URL.
 */
function isLinkedInProfileUrl(url) {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : "https://" + url;
    const parsed = new URL(normalized);
    return (
      (parsed.hostname === "linkedin.com" || parsed.hostname === "www.linkedin.com") &&
      parsed.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}

// ── Claude client ─────────────────────────────────────────────────────────────

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return new Anthropic({ apiKey: key });
}

// ── Build enrich prompt for LinkedIn profile ──────────────────────────────────

function buildLinkedInPrompt(profile) {
  const {
    fullName, headline, summary, location, profileUrl,
    currentPosition, currentCompany, skills = [],
    experience = [], education = [], certifications = [],
  } = profile;

  const expText = experience
    .slice(0, 4)
    .map((e) => `- ${e.title || ""} at ${e.company || ""} (${e.duration || ""})`)
    .join("\n");

  const eduText = education
    .slice(0, 3)
    .map((e) => `- ${e.degree || ""} from ${e.school || ""}`)
    .join("\n");

  const skillText = skills.slice(0, 10).join(", ");

  return `You are a professional web copywriter specializing in personal branding websites for professionals.
Given the following LinkedIn profile data, generate compelling personal website content.

## Profile Data
Name: ${fullName}
Headline: ${headline || "Not specified"}
Location: ${location || "Not specified"}
Current Position: ${currentPosition || "Not specified"} at ${currentCompany || "Not specified"}
Summary: ${summary || "Not provided"}

## Experience
${expText || "Not provided"}

## Education
${eduText || "Not provided"}

## Skills
${skillText || "Not listed"}

## Instructions
Generate website copy as a valid JSON object. Tailor it specifically to this person's professional identity.
Be specific, confident, and professional — avoid generic phrases.

{
  "heroHeadline": "A bold 6-10 word headline for the hero section capturing their professional identity or value proposition.",
  "tagline": "A compelling 8-12 word tagline that summarizes their professional brand. No clichés.",
  "aboutSummary": "2-3 engaging paragraphs (each 2-3 sentences) about this professional. Mention their expertise, experience, and what they bring to the table. Do NOT start with their name.",
  "ctaText": "2-4 word call-to-action button text (e.g. Let's Connect, View My Work, Hire Me, Get In Touch)",
  "seoDescription": "140-160 character meta description including their name, title, and key expertise for Google search.",
  "highlights": ["4-5 short professional highlights or key strengths, max 8 words each"],
  "subdomainWords": "1-3 words for the website subdomain URL, based on their name or brand. No hyphens or special chars (e.g. john smith or jane doe dev). Use their actual name."
}

Return ONLY the JSON object with no extra text, markdown, or code fences.`;
}

// ── POST /api/linkedin/lookup ─────────────────────────────────────────────────
// Validates the LinkedIn URL and extracts the username; returns basic profile
// shell so the frontend can immediately proceed to enrichment / site creation.
// NOTE: We do NOT scrape LinkedIn (ToS violation). Instead we accept whatever
// the user has entered and return the parsed public fields from the URL, then
// rely on the user filling in extra info or on Claude to synthesise the content.

router.post("/lookup", requireAuth, async (req, res, next) => {
  try {
    const { url, profile: manualProfile } = req.body;

    if (!url) return res.status(400).json({ message: "LinkedIn URL is required." });

    const normalized = /^https?:\/\//i.test(url) ? url : "https://" + url;

    if (!isLinkedInProfileUrl(normalized)) {
      return res.status(422).json({
        message:
          "That doesn't look like a LinkedIn profile URL. Use a URL like linkedin.com/in/your-name",
      });
    }

    const username = parseLinkedInUrl(normalized);
    if (!username) {
      return res.status(422).json({
        message: "Could not extract LinkedIn username from that URL.",
      });
    }

    // Merge manually-provided profile fields (user filled the form) or return minimal shell
    const profile = {
      username,
      profileUrl: `https://www.linkedin.com/in/${username}`,
      fullName: manualProfile?.fullName || username.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      headline: manualProfile?.headline || "",
      summary: manualProfile?.summary || "",
      location: manualProfile?.location || "",
      currentPosition: manualProfile?.currentPosition || "",
      currentCompany: manualProfile?.currentCompany || "",
      profilePhotoUrl: manualProfile?.profilePhotoUrl || "",
      bannerPhotoUrl: manualProfile?.bannerPhotoUrl || "",
      skills: manualProfile?.skills || [],
      experience: manualProfile?.experience || [],
      education: manualProfile?.education || [],
      certifications: manualProfile?.certifications || [],
      // Fields that the user needs to fill in
      missingFields: buildMissingFields(manualProfile),
    };

    res.json(profile);
  } catch (e) {
    next(e);
  }
});

function buildMissingFields(profile) {
  const missing = [];
  if (!profile?.fullName) missing.push({ id: "fullName", label: "Full name", type: "text", required: true });
  if (!profile?.headline) missing.push({ id: "headline", label: "Professional headline", type: "text", required: false });
  if (!profile?.summary) missing.push({ id: "summary", label: "About / Bio summary", type: "textarea", required: false });
  if (!profile?.currentPosition) missing.push({ id: "currentPosition", label: "Current job title", type: "text", required: false });
  if (!profile?.currentCompany) missing.push({ id: "currentCompany", label: "Current company", type: "text", required: false });
  if (!profile?.location) missing.push({ id: "location", label: "Location", type: "text", required: false });
  return missing;
}

// ── POST /api/linkedin/enrich ─────────────────────────────────────────────────
// Takes profile data and uses Claude to generate website copy.

router.post("/enrich", requireAuth, async (req, res, next) => {
  try {
    const client = getClient();
    const profile = req.body;

    if (!profile?.fullName) {
      return res.status(400).json({ message: "Profile data with fullName is required." });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: buildLinkedInPrompt(profile) }],
    });

    const text = message.content[0]?.text ?? "";

    let content;
    try {
      content = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        content = JSON.parse(match[0]);
      } else {
        throw new Error("Claude returned an unexpected response format.");
      }
    }

    const phrase =
      typeof content.subdomainWords === "string" ? content.subdomainWords.trim().slice(0, 120) : "";
    let suggestedCustomSubdomain = slugFromLLMSubdomainWords(phrase);
    if (!suggestedCustomSubdomain) {
      suggestedCustomSubdomain = slugFromLLMSubdomainWords(profile.fullName || "");
    }

    res.json({
      heroHeadline: content.heroHeadline ?? "",
      tagline: content.tagline ?? "",
      aboutSummary: content.aboutSummary ?? "",
      ctaText: content.ctaText ?? "Get In Touch",
      seoDescription: content.seoDescription ?? "",
      highlights: Array.isArray(content.highlights) ? content.highlights.slice(0, 5) : [],
      suggestedCustomSubdomain,
      subdomainSuggestionPhrase: phrase,
    });
  } catch (e) {
    if (e.message?.includes("ANTHROPIC_API_KEY")) {
      return res.status(503).json({
        code: "NO_ANTHROPIC_KEY",
        message: e.message,
        heroHeadline: "",
        tagline: "",
        aboutSummary: "",
        ctaText: "",
        seoDescription: "",
        highlights: [],
        suggestedCustomSubdomain: "",
        subdomainSuggestionPhrase: "",
      });
    }
    next(e);
  }
});

export default router;
