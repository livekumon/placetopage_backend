/**
 * Smoke-test for the Anthropic Claude API.
 * Run from the backend folder:  node test-claude-api.js
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

const ok   = (msg) => console.log(`${GREEN}  ✓${RESET} ${msg}`);
const fail = (msg) => console.log(`${RED}  ✗${RESET} ${msg}`);
const info = (msg) => console.log(`${DIM}    ${msg}${RESET}`);
const head = (msg) => console.log(`\n${BOLD}${CYAN}▶ ${msg}${RESET}`);

const key = process.env.ANTHROPIC_API_KEY;

if (!key) {
  console.error(`${RED}ERROR:${RESET} ANTHROPIC_API_KEY is not set in .env`);
  process.exit(1);
}

info(`Using key: ${key.slice(0, 14)}…${key.slice(-4)}`);

// ── Test 1: Basic message ────────────────────────────────────────────────────

head("Test 1 — Basic message (claude-sonnet-4-5)");

const client = new Anthropic({ apiKey: key });

let response;
try {
  response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });

  const text = response.content[0]?.text?.trim();
  ok(`Response received: "${text}"`);
  info(`Model        : ${response.model}`);
  info(`Input tokens : ${response.usage.input_tokens}`);
  info(`Output tokens: ${response.usage.output_tokens}`);
  info(`Stop reason  : ${response.stop_reason}`);
} catch (e) {
  fail(`API call failed: ${e.message}`);
  if (e.status === 401) info("→ Invalid API key. Check ANTHROPIC_API_KEY in .env");
  if (e.status === 403) info("→ Key does not have permission for this model.");
  if (e.status === 429) info("→ Rate limit or quota exceeded.");
  process.exit(1);
}

// ── Test 2: JSON generation (mirrors the enrich route) ───────────────────────

head("Test 2 — JSON generation (mirrors the /api/enrich route)");

try {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a copywriter. Given this business:
Name: Biryani Blues
Category: restaurant, Indian cuisine
Address: Connaught Place, New Delhi
Rating: 4.2/5 (2537 reviews)
Price level: Moderate

Return ONLY a valid JSON object (no extra text):
{
  "description": "2-3 sentence business description",
  "tagline": "5-10 word slogan",
  "heroHeadline": "6-10 word hero headline",
  "ctaText": "2-4 word CTA",
  "seoDescription": "140-160 char meta description",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"]
}`,
      },
    ],
  });

  const text = msg.content[0]?.text ?? "";

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  }

  if (!parsed) {
    fail("Could not parse JSON from response");
    info(`Raw response: ${text.slice(0, 200)}`);
    process.exit(1);
  }

  ok("Valid JSON returned");
  info(`description   : ${parsed.description?.slice(0, 80)}…`);
  info(`tagline       : ${parsed.tagline}`);
  info(`heroHeadline  : ${parsed.heroHeadline}`);
  info(`ctaText       : ${parsed.ctaText}`);
  info(`seoDescription: ${parsed.seoDescription?.slice(0, 80)}…`);
  info(`highlights    : ${parsed.highlights?.join(" | ")}`);
  info(`Tokens used   : ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out`);
} catch (e) {
  fail(`JSON generation test failed: ${e.message}`);
  process.exit(1);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${GREEN}${BOLD}All tests passed — Claude API (claude-sonnet-4-5) is working correctly.${RESET}\n`);
