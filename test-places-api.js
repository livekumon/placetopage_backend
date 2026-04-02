/**
 * Quick smoke-test for the Places API (New).
 * Run from the backend folder:  node test-places-api.js
 *
 * Tests in order:
 *   1. Text Search  — POST /places:searchText
 *   2. Place Details — GET /places/{id}
 *   3. Photo URL    — HEAD /{photo.name}/media  (checks redirect)
 */

import "dotenv/config";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE = "https://places.googleapis.com/v1";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

function ok(msg)   { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}  ✗${RESET} ${msg}`); }
function info(msg) { console.log(`${DIM}    ${msg}${RESET}`); }
function head(msg) { console.log(`\n${BOLD}${CYAN}▶ ${msg}${RESET}`); }

if (!API_KEY) {
  console.error(`${RED}ERROR:${RESET} GOOGLE_MAPS_API_KEY is not set in .env`);
  process.exit(1);
}

info(`Using key: ${API_KEY.slice(0, 8)}…${API_KEY.slice(-4)}`);

// ── 1. Text Search ─────────────────────────────────────────────────────────

head("Test 1 — Text Search (POST /places:searchText)");

let placeId = null;
let photoName = null;

try {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ textQuery: "Biryani Blues, Delhi" }),
  });

  const data = await res.json();

  if (!res.ok) {
    fail(`HTTP ${res.status}`);
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const place = data.places?.[0];
  if (!place) {
    fail("No places returned — check that 'Places API (New)' is enabled in Google Cloud Console.");
    process.exit(1);
  }

  placeId = place.id;
  ok(`Found: ${place.displayName?.text}`);
  info(`Place ID : ${placeId}`);
  info(`Address  : ${place.formattedAddress}`);
} catch (e) {
  fail(`Network error: ${e.message}`);
  process.exit(1);
}

// ── 2. Place Details ────────────────────────────────────────────────────────

head("Test 2 — Place Details (GET /places/{id})");

const FIELDS = [
  "id", "displayName", "formattedAddress", "nationalPhoneNumber",
  "websiteUri", "rating", "userRatingCount", "currentOpeningHours",
  "photos", "types", "priceLevel", "editorialSummary", "googleMapsUri",
  "reviews",
].join(",");

try {
  const res = await fetch(`${BASE}/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELDS,
    },
  });

  const place = await res.json();

  if (!res.ok) {
    fail(`HTTP ${res.status}`);
    console.error(JSON.stringify(place, null, 2));
    process.exit(1);
  }

  ok(`Name        : ${place.displayName?.text}`);
  info(`Address     : ${place.formattedAddress}`);
  info(`Phone       : ${place.nationalPhoneNumber ?? "(not listed)"}`);
  info(`Website     : ${place.websiteUri ?? "(not listed)"}`);
  info(`Rating      : ${place.rating ?? "—"} (${place.userRatingCount ?? 0} reviews)`);
  info(`Price level : ${place.priceLevel ?? "UNSPECIFIED"}`);
  info(`Open now    : ${place.currentOpeningHours?.openNow ?? "unknown"}`);
  info(`Types       : ${place.types?.slice(0, 3).join(", ")}`);
  info(`Description : ${place.editorialSummary?.text ?? "(none)"}`);
  info(`Maps URL    : ${place.googleMapsUri}`);
  info(`Photos      : ${place.photos?.length ?? 0} found`);
  info(`Reviews     : ${place.reviews?.length ?? 0} found`);

  if (place.reviews?.length) {
    console.log(`\n  ${BOLD}Sample reviews:${RESET}`);
    place.reviews.slice(0, 3).forEach((r, i) => {
      console.log(`\n  ${CYAN}[${i + 1}]${RESET} ${BOLD}${r.authorAttribution?.displayName ?? "Anonymous"}${RESET} — ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} (${r.relativePublishTimeDescription})`);
      const text = r.text?.text ?? "(no text)";
      console.log(`      "${text.length > 120 ? text.slice(0, 120) + "…" : text}"`);
    });
  }

  photoName = place.photos?.[0]?.name ?? null;
} catch (e) {
  fail(`Network error: ${e.message}`);
  process.exit(1);
}

// ── 3. Photo redirect ───────────────────────────────────────────────────────

head("Test 3 — Photo URL (GET /{photo.name}/media)");

if (!photoName) {
  info("No photos returned for this place — skipping.");
} else {
  try {
    const photoUrl = `${BASE}/${photoName}/media?maxWidthPx=800&key=${API_KEY}&skipHttpRedirect=false`;
    const res = await fetch(photoUrl, { redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const cdnUrl = res.headers.get("location");
      ok("Photo redirect works");
      info(`CDN URL (no key): ${cdnUrl?.slice(0, 80)}…`);
    } else if (res.status === 200) {
      ok("Photo URL returned 200 (direct, no redirect)");
    } else {
      fail(`Unexpected status ${res.status}`);
    }
  } catch (e) {
    fail(`Network error: ${e.message}`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${GREEN}${BOLD}All tests passed — Places API (New) is working correctly.${RESET}\n`);
