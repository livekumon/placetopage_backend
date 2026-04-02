import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── Claude client ─────────────────────────────────────────────────────────────

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return new Anthropic({ apiKey: key });
}

// ── Price level label ─────────────────────────────────────────────────────────

function priceLevelLabel(level) {
  return ["Free", "Budget-friendly", "Moderate", "Upscale", "Fine dining"][level] ?? "";
}

// ── Build the prompt ──────────────────────────────────────────────────────────

function buildPrompt(place) {
  const {
    name, address, types = [], rating, reviewCount,
    priceLevel, openingHours, phone, website,
    description, reviews = [],
  } = place;

  const categories = types
    .filter((t) => !["point_of_interest", "establishment", "food", "store"].includes(t))
    .slice(0, 4)
    .map((t) => t.replace(/_/g, " "))
    .join(", ");

  const reviewSnippets = reviews
    .filter((r) => r.text?.length > 20)
    .slice(0, 3)
    .map((r) => `- "${r.text.slice(0, 200)}" — ${r.author} (${r.rating}★)`)
    .join("\n");

  return `You are a professional copywriter for a website builder that generates business landing pages.
Given the following Google Maps business data, generate compelling website content.

## Business Data
Name: ${name}
Category: ${categories || "Business"}
Address: ${address}
Rating: ${rating ?? "N/A"}/5 (${reviewCount ?? 0} reviews)
Price level: ${priceLevel != null ? priceLevelLabel(priceLevel) : "Not specified"}
Phone: ${phone ?? "Not listed"}
Website: ${website ?? "None"}
Opening hours:
${openingHours?.join("\n") ?? "Not available"}
Google description: ${description ?? "None provided"}

## Customer Reviews
${reviewSnippets || "No reviews available"}

## Instructions
Generate the following content as a valid JSON object. Be specific to this business — avoid generic phrases. Keep the tone warm, confident and inviting.

{
  "description": "2–3 engaging sentences describing what makes this business special. Mention the category, atmosphere, and a key strength. Do NOT start with the business name.",
  "tagline": "A punchy 5–10 word slogan that captures the essence. No clichés like 'Best in town'.",
  "heroHeadline": "A bold 6–10 word headline for the website hero section. Focus on the customer benefit or experience.",
  "ctaText": "2–4 word call-to-action button text suited to this business type (e.g. Book a Table, Order Now, Visit Us, Reserve Your Spot)",
  "seoDescription": "A 140–160 character meta description for Google search results. Include the business name, location and main offering.",
  "highlights": ["3–4 short feature highlights shown as bullet points on the page, max 8 words each"]
}

Return ONLY the JSON object with no extra text, markdown, or code fences.`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const client = getClient();
    const place = req.body;

    if (!place?.name) {
      return res.status(400).json({ message: "place data is required" });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: buildPrompt(place),
        },
      ],
    });

    const text = message.content[0]?.text ?? "";

    let content;
    try {
      content = JSON.parse(text);
    } catch {
      // Strip any accidental markdown fences and retry
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        content = JSON.parse(match[0]);
      } else {
        throw new Error("Claude returned an unexpected response format.");
      }
    }

    res.json({
      description:    content.description    ?? "",
      tagline:        content.tagline         ?? "",
      heroHeadline:   content.heroHeadline    ?? "",
      ctaText:        content.ctaText         ?? "Learn More",
      seoDescription: content.seoDescription  ?? "",
      highlights:     Array.isArray(content.highlights) ? content.highlights.slice(0, 4) : [],
    });
  } catch (e) {
    // No API key configured — return empty fields so the flow continues manually
    if (e.message?.includes("ANTHROPIC_API_KEY")) {
      return res.status(503).json({
        code: "NO_ANTHROPIC_KEY",
        message: e.message,
        description: "", tagline: "", heroHeadline: "",
        ctaText: "", seoDescription: "", highlights: [],
      });
    }
    next(e);
  }
});

export default router;
