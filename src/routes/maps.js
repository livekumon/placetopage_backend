import { Router } from "express";
import https from "https";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Places API (New) base — completely separate from the legacy maps.googleapis.com API
const PLACES_V1 = "https://places.googleapis.com/v1";

// ── URL validation ────────────────────────────────────────────────────────────

/** Only require a parseable http(s) URL — actual Maps resolution is done via Places API. */
function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
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
  // Full Maps URLs often encode the place ID after "!1s" in the data fragment (ChIJ… or hex)
  const mChij = url.match(/!1s(ChIJ[^!&%]+)/);
  if (mChij) return decodeURIComponent(mChij[1]);
  const mHex = url.match(/!1s(0x[a-fA-F0-9]+)/);
  if (mHex) return decodeURIComponent(mHex[1]);
  try {
    const u = new URL(url);
    const pid = u.searchParams.get("place_id");
    if (pid) return pid;
    const ftid = u.searchParams.get("ftid");
    if (ftid) return decodeURIComponent(ftid);
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

/**
 * Text Search (New) — returns the first place ID, or null if nothing matches / API rejects query.
 * We pass full pasted URLs here so Google can resolve share links without brittle regex.
 */
async function findPlaceIdFromText(textQuery, apiKey) {
  const q = String(textQuery ?? "").trim();
  if (!q) return null;
  try {
    const data = await placesApiFetch("/places:searchText", apiKey, {
      method: "POST",
      body: { textQuery: q },
      fieldMask: "places.id",
    });
    return data.places?.[0]?.id ?? null;
  } catch {
    return null;
  }
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

/** Places API (New) returns `id` as `places/ChIJ…`; GET path must be `/v1/places/ChIJ…`. */
function placeIdForPath(id) {
  if (!id) return id;
  const s = String(id);
  return s.startsWith("places/") ? s.slice("places/".length) : s;
}

async function fetchPlaceDetails(placeId, apiKey) {
  const pathId = encodeURIComponent(placeIdForPath(placeId));
  return placesApiFetch(`/places/${pathId}`, apiKey, { fieldMask: DETAIL_FIELD_MASK });
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

    if (!isValidHttpUrl(url)) {
      return res.status(400).json({
        message: "Enter a valid web link (starting with http:// or https://).",
      });
    }

    const originalInput = url;

    // Expand short / opaque links (goo.gl, maps.app.goo.gl, share.google, g.co).
    let workingUrl = url;
    if (needsExpansion(url)) {
      const expanded = await expandShortUrl(url);
      if (expanded) workingUrl = expanded;
    }

    // 1) Parse place ID from URL when present
    let placeId =
      extractPlaceId(workingUrl) || extractPlaceId(originalInput);

    // 2) Ask Places API with the full URL(s) — handles many share formats without regex
    if (!placeId) {
      placeId = await findPlaceIdFromText(workingUrl, apiKey);
    }
    if (!placeId) {
      placeId = await findPlaceIdFromText(originalInput, apiKey);
    }

    // 3) Path segment after /maps/place/…
    if (!placeId) {
      const nameFromPath =
        extractPlaceName(workingUrl) || extractPlaceName(originalInput);
      if (nameFromPath) {
        placeId = await findPlaceIdFromText(nameFromPath, apiKey);
      }
    }

    if (!placeId) {
      return res.status(422).json({
        code: "PLACE_NOT_FOUND",
        message:
          "We couldn't find a business for this link. Open the place in Google Maps, use Share, paste the link here, or copy the URL from the address bar on the business page.",
      });
    }

    let place;
    try {
      place = await fetchPlaceDetails(placeId, apiKey);
    } catch (e) {
      console.error("fetchPlaceDetails:", e);
      return res.status(502).json({
        code: "PLACES_API_ERROR",
        message:
          e?.message?.includes("Places API") && e.message.length < 500
            ? e.message
            : "Google could not load details for this place. Check your API key and billing, then try again.",
      });
    }

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

    const idOut = place.id ? placeIdForPath(place.id) : placeIdForPath(placeId);

    res.json({
      placeId: idOut,
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
