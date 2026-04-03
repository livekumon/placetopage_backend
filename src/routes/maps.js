import { Router } from "express";
import https from "https";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Places API (New) base — completely separate from the legacy maps.googleapis.com API
const PLACES_V1 = "https://places.googleapis.com/v1";

// ── URL validation ────────────────────────────────────────────────────────────

/**
 * Returns true for any URL format that Google uses to share map locations.
 * Kept intentionally broad so we attempt expansion/lookup rather than
 * rejecting valid but unfamiliar links outright.
 */
function isGoogleMapsUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (
      h.startsWith("maps.google.")    ||  // maps.google.com / .co.in / .co.uk …
      ((h === "www.google.com" || h === "google.com") &&
        u.pathname.startsWith("/maps")) ||
      (h === "goo.gl" && u.pathname.startsWith("/maps")) ||
      h === "maps.app.goo.gl"         ||  // standard share link
      h === "share.google"            ||  // new share.google/XXXXX format
      h === "g.co"                        // Google's own short-domain
    );
  } catch {
    return false;
  }
}

/**
 * Returns true for URL formats that are short/opaque and need a redirect
 * chain to be resolved into a full Google Maps URL before we can parse them.
 */
function needsExpansion(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "goo.gl"           ||
      h === "maps.app.goo.gl"  ||
      h === "share.google"     ||
      h === "g.co"
    );
  } catch {
    return false;
  }
}

// ── Short-URL expander — follows the full redirect chain ──────────────────────

/** Follows a single HTTP redirect and returns the Location header, or null. */
function followOneRedirect(url) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, { timeout: 8000 }, (res) => {
        res.resume();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Location may be relative — resolve against the current URL
          try {
            resolve(new URL(res.headers.location, url).href);
          } catch {
            resolve(res.headers.location);
          }
        } else {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Follows a redirect chain up to `maxHops` times.
 * Stops early once we land on a URL that no longer redirects or that is
 * already a full Google Maps URL (no further expansion needed).
 */
async function expandShortUrl(shortUrl, maxHops = 6) {
  let current = shortUrl;
  for (let i = 0; i < maxHops; i++) {
    const next = await followOneRedirect(current);
    if (!next || next === current) break;
    current = next;
    // Once we've landed on a full maps URL, no need to keep following
    if (!needsExpansion(current)) break;
  }
  return current;
}

// ── Place ID extraction from URL ──────────────────────────────────────────────

function extractPlaceId(url) {
  // Full Maps URLs encode the ChIJ… place ID after "!1s" in the data fragment
  const m = url.match(/!1s(ChIJ[^!&%]+)/);
  if (m) return decodeURIComponent(m[1]);
  try {
    const pid = new URL(url).searchParams.get("place_id");
    if (pid) return pid;
  } catch {}
  return null;
}

function extractPlaceName(url) {
  try {
    const m = new URL(url).pathname.match(/\/maps\/place\/([^/]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {}
  return null;
}

// ── Places API (New) helpers ──────────────────────────────────────────────────

/**
 * Generic fetch to the New Places API.
 * Auth is via the X-Goog-Api-Key header (not a ?key= query param).
 * Field selections go in X-Goog-FieldMask.
 */
async function placesApiFetch(path, apiKey, { method = "GET", body, fieldMask } = {}) {
  const headers = {
    "X-Goog-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;

  const res = await fetch(`${PLACES_V1}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Places API (New) error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Text Search → returns the first matching place ID */
async function findPlaceId(query, apiKey) {
  const data = await placesApiFetch("/places:searchText", apiKey, {
    method: "POST",
    body: { textQuery: query },
    fieldMask: "places.id",
  });
  return data.places?.[0]?.id ?? null;
}

/** Place Details (New API) — all the fields we need */
const DETAIL_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "currentOpeningHours",
  "regularOpeningHours",
  "photos",
  "types",
  "priceLevel",
  "editorialSummary",
  "location",
  "businessStatus",
  "googleMapsUri",
  "reviews",
].join(",");

async function fetchPlaceDetails(placeId, apiKey) {
  return placesApiFetch(`/places/${placeId}`, apiKey, { fieldMask: DETAIL_FIELD_MASK });
}

/**
 * Photo serving — New API redirects to a key-free Google CDN URL.
 * We follow the redirect server-side so the raw API key is never returned
 * to the browser.
 */
function resolvePhotoUrl(photoName, apiKey) {
  const apiUrl = `${PLACES_V1}/${photoName}/media?maxWidthPx=1200&key=${apiKey}&skipHttpRedirect=false`;
  return new Promise((resolve) => {
    const req = https.get(apiUrl, { timeout: 8000 }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location); // key-free Google CDN URL
      } else {
        resolve(apiUrl); // fallback — includes key, but better than no photo
      }
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/**
 * The New API returns priceLevel as a string enum.
 * Convert to the 0-3 numeric scale used by the frontend.
 */
function parsePriceLevel(level) {
  const map = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level] ?? null;
}

// ── Missing-fields detection ──────────────────────────────────────────────────

function detectMissingFields(place) {
  const fields = [];

  if (!place.nationalPhoneNumber && !place.internationalPhoneNumber) {
    fields.push({
      id: "phone",
      label: "Phone number",
      hint: "Not found on Google Maps — add it so visitors can call you.",
      type: "tel",
      placeholder: "+1 (555) 000-0000",
      required: false,
    });
  }

  if (!place.websiteUri) {
    fields.push({
      id: "website",
      label: "Existing website URL (if any)",
      hint: "We'll link to it from your new page.",
      type: "url",
      placeholder: "https://yourwebsite.com",
      required: false,
    });
  }

  if (!place.editorialSummary?.text) {
    fields.push({
      id: "description",
      label: "Describe your business",
      hint: "A short paragraph about what makes your business special.",
      type: "textarea",
      placeholder:
        "We serve handcrafted coffee and homemade pastries in a cozy neighbourhood setting…",
      required: true,
    });
  }

  // Tagline is almost never in Google Maps — always ask
  fields.push({
    id: "tagline",
    label: "Your tagline or slogan",
    hint: "A catchy one-liner shown prominently on your page.",
    type: "text",
    placeholder: 'e.g. "Fresh ingredients, bold flavours"',
    required: false,
  });

  return fields;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/lookup", requireAuth, async (req, res, next) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        message:
          "GOOGLE_MAPS_API_KEY is not set on the server. Add it to backend/.env and restart.",
      });
    }

    let { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    if (!isGoogleMapsUrl(url)) {
      return res.status(422).json({
        code: "NOT_GOOGLE_MAPS",
        message:
          "That doesn't look like a Google Maps link. Open any business on maps.google.com and copy the URL from your browser's address bar.",
      });
    }

    // Expand short / opaque links before parsing (goo.gl, maps.app.goo.gl,
    // share.google, g.co — all redirect to the full canonical Maps URL).
    if (needsExpansion(url)) {
      const expanded = await expandShortUrl(url);
      // After expansion, re-validate — the resolved URL must still be a Maps URL.
      // If it's not (e.g. a generic google.com page), surface a clear error.
      if (expanded !== url && !isGoogleMapsUrl(expanded)) {
        return res.status(422).json({
          code: "NOT_GOOGLE_MAPS",
          message:
            "That link didn't resolve to a Google Maps business page. Please open the business on Google Maps and copy the URL from the address bar.",
        });
      }
      url = expanded;
    }

    // Try to extract the ChIJ… place ID directly from the URL
    let placeId = extractPlaceId(url);

    // Fallback: search by business name from the URL path
    if (!placeId) {
      const name = extractPlaceName(url);
      if (name) placeId = await findPlaceId(name, apiKey);
    }

    if (!placeId) {
      return res.status(422).json({
        code: "PLACE_NOT_FOUND",
        message:
          "Could not identify the business from this link. Try copying the full URL directly from Google Maps while the business page is open.",
      });
    }

    const place = await fetchPlaceDetails(placeId, apiKey);

    // Resolve up to 20 photo URLs in parallel (server-side → key-free CDN URLs)
    const photoNames = (place.photos ?? []).slice(0, 20).map((p) => p.name).filter(Boolean);
    const resolvedPhotos = await Promise.all(
      photoNames.map((name) => resolvePhotoUrl(name, apiKey))
    );
    const photos = resolvedPhotos.filter(Boolean);
    const photoUrl = photos[0] ?? null;

    // Normalise the Google reviews into a clean shape
    const reviews = (place.reviews ?? []).map((r) => ({
      author: r.authorAttribution?.displayName ?? "Anonymous",
      authorPhoto: r.authorAttribution?.photoUri ?? null,
      rating: r.rating ?? null,
      text: r.text?.text ?? "",
      relativeTime: r.relativePublishTimeDescription ?? "",
    }));

    res.json({
      placeId,
      name: place.displayName?.text ?? "Unknown",
      address: place.formattedAddress ?? "",
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
      website: place.websiteUri || null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? 0,
      types: place.types ?? [],
      priceLevel: parsePriceLevel(place.priceLevel),
      openingHours:
        place.currentOpeningHours?.weekdayDescriptions ??
        place.regularOpeningHours?.weekdayDescriptions ??
        null,
      isOpenNow: place.currentOpeningHours?.openNow ?? null,
      description: place.editorialSummary?.text ?? null,
      photoUrl,
      photos,
      location: place.location ?? null,
      mapsUrl: place.googleMapsUri || url,
      reviews,
      missingFields: detectMissingFields(place),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
