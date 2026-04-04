import { Router } from "express";
import https from "https";
import { requireAuth } from "../middleware/auth.js";
import { resolveUrlViaBrowser } from "../utils/browserResolver.js";

const router = Router();

const PLACES_V1 = "https://places.googleapis.com/v1";

// ── Short-URL / redirect detection ───────────────────────────────────────────

/**
 * Domains whose URLs are opaque tokens that must be expanded
 * (via HTTP redirects or headless browser) before any parsing.
 */
function isShortOrOpaqueUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (
      h === "goo.gl" ||
      h === "maps.app.goo.gl" ||
      h === "share.google" ||
      h === "g.co" ||
      h === "g.page" ||
      h.endsWith(".g.page") ||
      (h === "www.google.com" && u.pathname === "/share.google")
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when the URL is a Google Maps page we can parse directly
 * (has a /maps path, or is maps.google.* domain, etc.).
 */
function isMapsPageUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (
      u.pathname.startsWith("/maps") ||
      h === "maps.google.com" ||
      h.startsWith("maps.google.") ||
      u.searchParams.has("ftid") ||
      u.searchParams.has("cid") ||
      u.searchParams.has("place_id")
    );
  } catch {
    return false;
  }
}

// ── HTTP redirect follower ───────────────────────────────────────────────────

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
 * Follow HTTP 3xx redirect chain until it settles (maxHops or no more redirects).
 * Does NOT handle JavaScript-based redirects — use resolveUrlViaBrowser for that.
 */
async function expandUrl(shortUrl, maxHops = 8) {
  let current = shortUrl;
  for (let i = 0; i < maxHops; i++) {
    const next = await followOneRedirect(current);
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

// ── Signal extraction ────────────────────────────────────────────────────────

/**
 * Extract every useful signal from a URL without assuming which format it is.
 *
 * Handles all known Google Maps URL formats:
 *
 *  Share links (after expansion):
 *    maps.google.com?ftid=0xNODE:0xFACE&entry=gps          ← hex ftid
 *    www.google.com/maps?ftid=ChIJ...                       ← ChIJ ftid (rare)
 *
 *  Desktop / browser address bar:
 *    www.google.com/maps/place/Name/@lat,lng,zoom/data=!...!1sChIJ...
 *    www.google.com/maps/place/Name/@lat,lng,zoom
 *    www.google.com/maps/place/Name/
 *
 *  CID links:
 *    www.google.com/maps?cid=1234567890
 *
 *  Search / query links:
 *    www.google.com/maps?q=Business+Name
 *    www.google.com/maps/search/Business+Name
 *
 *  Coordinate-only:
 *    www.google.com/maps/@lat,lng,zoom
 *    www.google.com/maps?ll=lat,lng
 */
function extractSignals(url) {
  const signals = {
    chijPlaceId: null,
    cid: null,
    hexFtid: null,
    kgmid: null,          // Knowledge Graph machine ID (e.g. /g/11p779tntx)
    coordinates: null,
    placeName: null,
    searchQuery: null,
  };

  // ChIJ place ID from !1s data fragment (desktop URLs)
  const mChij = url.match(/!1s(ChIJ[^!&%\s]+)/);
  if (mChij) {
    try {
      signals.chijPlaceId = decodeURIComponent(mChij[1]);
    } catch {}
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

    // place_id= query param
    const pid = u.searchParams.get("place_id");
    if (pid && !signals.chijPlaceId) signals.chijPlaceId = pid;

    // ftid= — either ChIJ or hex node:face pair
    const ftid = u.searchParams.get("ftid");
    if (ftid) {
      if (/^0x[a-fA-F0-9]+:0x[a-fA-F0-9]+$/i.test(ftid)) {
        signals.hexFtid = ftid;
      } else if (!signals.chijPlaceId) {
        try {
          signals.chijPlaceId = decodeURIComponent(ftid);
        } catch {}
      }
    }

    // cid= decimal CID
    const cid = u.searchParams.get("cid");
    if (cid && /^\d+$/.test(cid)) signals.cid = cid;

    // kgmid= Knowledge Graph machine ID (from Google Search / sorry pages)
    const kgmid = u.searchParams.get("kgmid");
    if (kgmid) signals.kgmid = kgmid;

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

/**
 * Merge two signal objects, preferring the first non-null value for each key.
 */
function mergeSignals(a, b) {
  return {
    chijPlaceId: a.chijPlaceId || b.chijPlaceId,
    cid: a.cid || b.cid,
    hexFtid: a.hexFtid || b.hexFtid,
    kgmid: a.kgmid || b.kgmid,
    coordinates: a.coordinates || b.coordinates,
    placeName: a.placeName || b.placeName,
    searchQuery: a.searchQuery || b.searchQuery,
  };
}

function hasUsableSignals(s) {
  return !!(
    s.chijPlaceId ||
    s.cid ||
    s.hexFtid ||
    s.kgmid ||
    s.placeName ||
    s.searchQuery
  );
}

// ── Places API helpers ───────────────────────────────────────────────────────

async function placesApiFetch(
  path,
  apiKey,
  { method = "GET", body, fieldMask } = {}
) {
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

function placeIdForPath(id) {
  if (!id) return id;
  const s = String(id);
  return s.startsWith("places/") ? s.slice("places/".length) : s;
}

/**
 * Resolve extracted signals → canonical ChIJ place ID.
 *
 * Resolution order (most → least reliable):
 *   1. ChIJ directly in URL (!1s fragment, place_id=, non-hex ftid=)
 *   2. Decimal CID → legacy Places API
 *   3. Hex ftid → CID → legacy Places API
 *   4. Knowledge Graph ID (kgmid) + search query → text search
 *   5. Name + coordinates → searchText with tight bias (200 m)
 *   6. Name + coordinates → searchText with wider bias (2 km)
 *   7. Name alone → searchText
 *   8. Search query (q=) → searchText
 */
async function resolveToPlaceId(signals, apiKey) {
  if (signals.chijPlaceId) return signals.chijPlaceId;

  if (signals.cid) {
    const pid = await findPlaceIdByCid(signals.cid, apiKey);
    if (pid) return pid;
  }

  if (signals.hexFtid) {
    const cid = hexFtidToCid(signals.hexFtid);
    if (cid) {
      const pid = await findPlaceIdByCid(cid, apiKey);
      if (pid) return pid;
    }
  }

  // kgmid + search query: the q= from a Google Search URL after share.google
  // resolution is the exact business name — highest-quality text signal.
  if (signals.kgmid && signals.searchQuery) {
    const pid = await findPlaceIdFromText(signals.searchQuery, apiKey);
    if (pid) return pid;
  }

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

  if (signals.placeName) {
    const pid = await findPlaceIdFromText(signals.placeName, apiKey);
    if (pid) return pid;
  }

  if (signals.searchQuery) {
    const pid = await findPlaceIdFromText(signals.searchQuery, apiKey);
    if (pid) return pid;
  }

  return null;
}

// ── Place details ────────────────────────────────────────────────────────────

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

// ── Route ────────────────────────────────────────────────────────────────────

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

    const originalInput = url;

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY A — Fast path: HTTP redirect expansion + signal extraction
    // ─────────────────────────────────────────────────────────────────────────

    let workingUrl = url;
    if (isShortOrOpaqueUrl(url)) {
      const expanded = await expandUrl(url);
      if (expanded) workingUrl = expanded;
    }

    console.log("[maps/lookup] input  :", originalInput.slice(0, 150));
    console.log("[maps/lookup] httpExp:", workingUrl.slice(0, 150));

    let signals = mergeSignals(
      extractSignals(workingUrl),
      extractSignals(originalInput)
    );

    console.log("[maps/lookup] signals (A):", JSON.stringify(signals));

    let placeId = hasUsableSignals(signals)
      ? await resolveToPlaceId(signals, apiKey)
      : null;

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY B — Headless browser: follow JS redirects
    //   Only triggered when HTTP expansion didn't give us a Maps-parsable URL
    //   (e.g. share.google, g.page, or any new opaque format Google invents).
    // ─────────────────────────────────────────────────────────────────────────

    if (!placeId && (!isMapsPageUrl(workingUrl) || !hasUsableSignals(signals))) {
      console.log("[maps/lookup] strategy A failed — launching headless browser…");
      const browserUrl = await resolveUrlViaBrowser(originalInput);

      if (browserUrl && browserUrl !== workingUrl && browserUrl !== originalInput) {
        console.log("[maps/lookup] browser resolved:", browserUrl.slice(0, 200));

        const browserSignals = extractSignals(browserUrl);
        signals = mergeSignals(browserSignals, signals);

        console.log("[maps/lookup] signals (B):", JSON.stringify(signals));

        if (hasUsableSignals(signals)) {
          placeId = await resolveToPlaceId(signals, apiKey);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STRATEGY C — Last-resort: send raw URLs as text search
    // ─────────────────────────────────────────────────────────────────────────

    if (!placeId) {
      placeId = await findPlaceIdFromText(workingUrl, apiKey);
    }
    if (!placeId && originalInput !== workingUrl) {
      placeId = await findPlaceIdFromText(originalInput, apiKey);
    }

    if (!placeId) {
      return res.status(422).json({
        code: "PLACE_NOT_FOUND",
        message:
          "We couldn't find a business for this link. " +
          "Open Google Maps in your browser, search for the business, then copy the full URL from the address bar and paste it here.",
      });
    }

    // ── Fetch full place details ─────────────────────────────────────────────
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

    // ── Resolve photos ───────────────────────────────────────────────────────
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

    const idOut = place.id
      ? placeIdForPath(place.id)
      : placeIdForPath(placeId);

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
