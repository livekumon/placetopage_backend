import { Router } from "express";
import https from "https";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const PLACES_V1 = "https://places.googleapis.com/v1";

// ── Short-URL expander ────────────────────────────────────────────────────────

/**
 * Domains that require redirect-following before we can parse any place info.
 * google.com/maps, maps.google.com etc. are NOT short — they already carry
 * query params or path segments we can parse directly.
 */
function isShortUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "goo.gl" ||
      h === "maps.app.goo.gl" ||
      h === "share.google" ||
      h === "g.co"
    );
  } catch {
    return false;
  }
}

function followOneRedirect(url) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, { timeout: 8000 }, (res) => {
        res.resume();
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
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
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Follow the redirect chain until no more redirects or maxHops reached.
 * We keep following even past known Google Maps hosts because some
 * chains go: maps.app.goo.gl → maps.google.com → www.google.com/maps.
 */
async function expandUrl(shortUrl, maxHops = 8) {
  let current = shortUrl;
  for (let i = 0; i < maxHops; i++) {
    const next = await followOneRedirect(current);
    if (!next || next === current) break;
    current = next;
    if (!isShortUrl(current)) break;
  }
  return current;
}

// ── Signal extraction ─────────────────────────────────────────────────────────

/**
 * Extract every useful signal from a URL without assuming which format it is.
 * Signals are tried in reliability order by resolveToPlaceId().
 *
 * Handles all known Google Maps URL formats:
 *
 *  Share links (after expansion):
 *    https://maps.google.com?ftid=0xNODE:0xFACE&entry=gps          ← hex ftid
 *    https://www.google.com/maps?ftid=ChIJ...                       ← ChIJ ftid (rare)
 *
 *  Desktop / browser address bar:
 *    https://www.google.com/maps/place/Name/@lat,lng,zoom/data=!4m...!1sChIJ...
 *    https://www.google.com/maps/place/Name/@lat,lng,zoom            ← no data fragment
 *    https://www.google.com/maps/place/Name/
 *
 *  CID links:
 *    https://www.google.com/maps?cid=1234567890
 *
 *  Search / query links:
 *    https://www.google.com/maps?q=Business+Name
 *    https://www.google.com/maps?q=lat,lng
 *    https://www.google.com/maps/search/Business+Name
 *
 *  Coordinate-only (map view — no specific business):
 *    https://www.google.com/maps/@lat,lng,zoom
 *    https://www.google.com/maps?ll=lat,lng
 */
function extractSignals(url) {
  const signals = {
    chijPlaceId: null,  // Direct ChIJ… → fetchPlaceDetails
    cid: null,          // Decimal CID  → findPlaceIdByCid (legacy)
    hexFtid: null,      // 0xNODE:0xFACE → hexFtidToCid → findPlaceIdByCid
    coordinates: null,  // { lat, lng }  → searchText with locationBias
    placeName: null,    // From /place/NAME/ or /search/NAME
    searchQuery: null,  // From q= param (non-coordinate)
  };

  // ChIJ place ID from !1s data fragment (desktop URLs)
  const mChij = url.match(/!1s(ChIJ[^!&%\s]+)/);
  if (mChij) {
    try { signals.chijPlaceId = decodeURIComponent(mChij[1]); } catch {}
  }

  // Coordinates from @lat,lng in the path
  const mAt = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (mAt) {
    signals.coordinates = {
      lat: parseFloat(mAt[1]),
      lng: parseFloat(mAt[2]),
    };
  }

  try {
    const u = new URL(url);

    // place_id= query param (explicit place ID, very reliable)
    const pid = u.searchParams.get("place_id");
    if (pid && !signals.chijPlaceId) signals.chijPlaceId = pid;

    // ftid= — either ChIJ or hex node:face pair
    const ftid = u.searchParams.get("ftid");
    if (ftid) {
      if (/^0x[a-fA-F0-9]+:0x[a-fA-F0-9]+$/i.test(ftid)) {
        signals.hexFtid = ftid;
      } else if (!signals.chijPlaceId) {
        try { signals.chijPlaceId = decodeURIComponent(ftid); } catch {}
      }
    }

    // cid= decimal CID (e.g. ?cid=8840259170776956313)
    const cid = u.searchParams.get("cid");
    if (cid && /^\d+$/.test(cid)) signals.cid = cid;

    // ll= coordinates
    const ll = u.searchParams.get("ll");
    if (ll && !signals.coordinates) {
      const mLl = ll.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)$/);
      if (mLl) {
        signals.coordinates = {
          lat: parseFloat(mLl[1]),
          lng: parseFloat(mLl[2]),
        };
      }
    }

    // q= — either a lat,lng pair or a text query
    const q = u.searchParams.get("q");
    if (q) {
      const mQ = q.match(/^(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)$/);
      if (mQ && !signals.coordinates) {
        signals.coordinates = {
          lat: parseFloat(mQ[1]),
          lng: parseFloat(mQ[2]),
        };
      } else if (!mQ) {
        signals.searchQuery = q;
      }
    }

    // Business name from /maps/place/NAME/ or /maps/search/NAME
    const namePath =
      u.pathname.match(/\/maps\/place\/([^/@+][^/@]*?)(?:\/|$)/) ||
      u.pathname.match(/\/maps\/search\/([^/@+][^/@]*?)(?:\/|$)/);
    if (namePath) {
      try {
        signals.placeName = decodeURIComponent(
          namePath[1].replace(/\+/g, " ")
        ).trim();
        if (!signals.placeName) signals.placeName = null;
      } catch {}
    }
  } catch {}

  return signals;
}

// ── Places API helpers ────────────────────────────────────────────────────────

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
 * Text Search → first matching place ID, or null.
 * Used for business-name and search-query signals.
 */
async function findPlaceIdFromText(textQuery, apiKey, locationBias = null) {
  const q = String(textQuery ?? "").trim();
  if (!q) return null;
  try {
    const body = { textQuery: q, maxResultCount: 1 };
    if (locationBias) body.locationBias = locationBias;
    const data = await placesApiFetch("/places:searchText", apiKey, {
      method: "POST",
      body,
      fieldMask: "places.id",
    });
    const id = data.places?.[0]?.id ?? null;
    return id ? placeIdForPath(id) : null;
  } catch {
    return null;
  }
}

/**
 * Legacy Places API: CID (decimal) → ChIJ place_id.
 * The New Places API does not accept CIDs or hex ftid values.
 */
async function findPlaceIdByCid(cid, apiKey) {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?cid=${encodeURIComponent(cid)}&fields=place_id&key=${apiKey}`
    );
    if (!res.ok) return null;
    const j = await res.json();
    return j?.result?.place_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert hex ftid (0xNODE:0xFACE) to decimal CID.
 * The CID is the unsigned decimal of the second (face) hex component.
 */
function hexFtidToCid(ftid) {
  const m =
    ftid && String(ftid).match(/^0x[a-fA-F0-9]+:0x([a-fA-F0-9]+)$/i);
  if (!m) return null;
  try {
    return BigInt(`0x${m[1]}`).toString(10);
  } catch {
    return null;
  }
}

/** Strip the `places/` prefix that the New Places API returns on `id` fields. */
function placeIdForPath(id) {
  if (!id) return id;
  const s = String(id);
  return s.startsWith("places/") ? s.slice("places/".length) : s;
}

/**
 * Resolve a set of extracted signals to a canonical ChIJ place ID.
 *
 * Resolution order (most → least reliable):
 *   1. ChIJ directly in URL (!1s fragment, place_id=, non-hex ftid=)
 *   2. Decimal CID (cid= param) → legacy Places API
 *   3. Hex ftid (0xNODE:0xFACE) → CID → legacy Places API
 *   4. Business name + coordinates → searchText with locationBias (tight 200m)
 *   5. Business name + coordinates → searchText with locationBias (wider 2km)
 *   6. Business name alone → searchText
 *   7. Search query (q=) → searchText
 */
async function resolveToPlaceId(signals, apiKey) {
  // 1. Direct ChIJ
  if (signals.chijPlaceId) return signals.chijPlaceId;

  // 2. CID → legacy Places API
  if (signals.cid) {
    const pid = await findPlaceIdByCid(signals.cid, apiKey);
    if (pid) return pid;
  }

  // 3. Hex ftid → CID → legacy Places API
  if (signals.hexFtid) {
    const cid = hexFtidToCid(signals.hexFtid);
    if (cid) {
      const pid = await findPlaceIdByCid(cid, apiKey);
      if (pid) return pid;
    }
  }

  // 4 & 5. Name + coordinates → searchText with location bias (tight then wide)
  if (signals.placeName && signals.coordinates) {
    const { lat, lng } = signals.coordinates;
    const center = { latitude: lat, longitude: lng };
    for (const radius of [200, 2000]) {
      const pid = await findPlaceIdFromText(signals.placeName, apiKey, {
        circle: { center, radius },
      });
      if (pid) return pid;
    }
  }

  // 6. Name alone → searchText
  if (signals.placeName) {
    const pid = await findPlaceIdFromText(signals.placeName, apiKey);
    if (pid) return pid;
  }

  // 7. Search query (q= param) → searchText
  if (signals.searchQuery) {
    const pid = await findPlaceIdFromText(signals.searchQuery, apiKey);
    if (pid) return pid;
  }

  return null;
}

// ── Place details ─────────────────────────────────────────────────────────────

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
  const pathId = encodeURIComponent(placeIdForPath(placeId));
  return placesApiFetch(`/places/${pathId}`, apiKey, {
    fieldMask: DETAIL_FIELD_MASK,
  });
}

function resolvePhotoUrl(photoName, apiKey) {
  const apiUrl = `${PLACES_V1}/${photoName}/media?maxWidthPx=1200&key=${apiKey}&skipHttpRedirect=false`;
  return new Promise((resolve) => {
    const req = https.get(apiUrl, { timeout: 8000 }, (res) => {
      res.resume();
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        resolve(res.headers.location);
      } else {
        resolve(apiUrl);
      }
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

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

    try {
      new URL(url);
    } catch {
      return res
        .status(400)
        .json({ message: "Enter a valid link (http or https)." });
    }

    // ── Step 1: expand short/redirect URLs ───────────────────────────────────
    const originalInput = url;
    let workingUrl = url;
    if (isShortUrl(url)) {
      const expanded = await expandUrl(url);
      if (expanded) workingUrl = expanded;
    }

    console.log("[maps/lookup] input:", originalInput.slice(0, 120));
    console.log("[maps/lookup] working:", workingUrl.slice(0, 120));

    // ── Step 2: extract signals from both URL variants ───────────────────────
    const sigA = extractSignals(workingUrl);
    const sigB = extractSignals(originalInput);

    // Merge: prefer workingUrl signals, fall back to originalInput
    const signals = {
      chijPlaceId: sigA.chijPlaceId || sigB.chijPlaceId,
      cid:         sigA.cid         || sigB.cid,
      hexFtid:     sigA.hexFtid     || sigB.hexFtid,
      coordinates: sigA.coordinates || sigB.coordinates,
      placeName:   sigA.placeName   || sigB.placeName,
      searchQuery: sigA.searchQuery || sigB.searchQuery,
    };

    console.log("[maps/lookup] signals:", JSON.stringify(signals));

    // ── Step 3: resolve signals → ChIJ place ID ──────────────────────────────
    let placeId = await resolveToPlaceId(signals, apiKey);

    // Last-resort: send the full URL text to searchText
    // (handles some cases where Google's own API understands the URL)
    if (!placeId) {
      placeId = await findPlaceIdFromText(workingUrl, apiKey);
    }
    if (!placeId) {
      placeId = await findPlaceIdFromText(originalInput, apiKey);
    }

    if (!placeId) {
      return res.status(422).json({
        code: "PLACE_NOT_FOUND",
        message:
          "We couldn't find a business for this link. Try opening Google Maps, tapping Share on the business, and pasting that link here.",
      });
    }

    // ── Step 4: fetch full place details ─────────────────────────────────────
    let place;
    try {
      place = await fetchPlaceDetails(placeId, apiKey);
    } catch (e) {
      console.error("[maps/lookup] fetchPlaceDetails error:", e.message);
      return res.status(502).json({
        code: "PLACES_API_ERROR",
        message:
          e?.message?.includes("Places API") && e.message.length < 500
            ? e.message
            : "Google could not load details for this place. Check your API key and billing, then try again.",
      });
    }

    // ── Step 5: resolve photos ────────────────────────────────────────────────
    const photoNames = (place.photos ?? [])
      .slice(0, 20)
      .map((p) => p.name)
      .filter(Boolean);
    const resolvedPhotos = await Promise.all(
      photoNames.map((name) => resolvePhotoUrl(name, apiKey))
    );
    const photos = resolvedPhotos.filter(Boolean);

    const reviews = (place.reviews ?? []).map((r) => ({
      author: r.authorAttribution?.displayName ?? "Anonymous",
      authorPhoto: r.authorAttribution?.photoUri ?? null,
      rating: r.rating ?? null,
      text: r.text?.text ?? "",
      relativeTime: r.relativePublishTimeDescription ?? "",
    }));

    const idOut = place.id ? placeIdForPath(place.id) : placeIdForPath(placeId);

    return res.json({
      placeId: idOut,
      name: place.displayName?.text ?? "Unknown",
      address: place.formattedAddress ?? "",
      phone:
        place.nationalPhoneNumber || place.internationalPhoneNumber || null,
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
      photoUrl: photos[0] ?? null,
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
