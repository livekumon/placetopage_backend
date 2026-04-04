import puppeteer from "puppeteer";

let _browserPromise = null;

/**
 * Lazy-initialise a shared headless Chromium instance.
 * Re-creates the browser if the previous one disconnected.
 */
async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      if (b.connected) return b;
    } catch {
      /* stale promise — fall through to relaunch */
    }
    _browserPromise = null;
  }

  _browserPromise = puppeteer
    .launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--single-process",
      ],
    })
    .catch((err) => {
      _browserPromise = null;
      throw err;
    });

  return _browserPromise;
}

/**
 * Navigate to `inputUrl` in a headless Chromium tab, wait for all
 * HTTP + JavaScript redirects to settle, and return the final URL.
 *
 * Returns `null` on any error (browser launch failure, timeout, etc.)
 * so callers can fall through to the next resolution strategy.
 */
export async function resolveUrlViaBrowser(inputUrl, timeoutMs = 30000) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(t)) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.goto(inputUrl, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });

    let finalUrl = page.url();

    if (!looksLikeMapsUrl(finalUrl)) {
      try {
        await page.waitForFunction(
          () => {
            const h = window.location.href;
            return (
              h.includes("/maps/") ||
              h.includes("maps.google") ||
              h.includes("place_id") ||
              h.includes("ftid=") ||
              h.includes("cid=")
            );
          },
          { timeout: 12000 }
        );
        finalUrl = page.url();
      } catch {
        finalUrl = page.url();
      }
    }

    // Google CAPTCHA / "sorry" pages embed the original destination in the
    // `continue` query param. Extract it so the caller can parse signals.
    const unwrapped = unwrapSorryPage(finalUrl);
    if (unwrapped) {
      console.log("[browserResolver] unwrapped sorry page →", unwrapped.slice(0, 200));
      return unwrapped;
    }

    console.log("[browserResolver] resolved:", finalUrl.slice(0, 200));
    return finalUrl;
  } catch (err) {
    console.error("[browserResolver] error:", err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * When Google returns a CAPTCHA ("sorry") page, the intended destination
 * is encoded in the `continue` query param. Return that URL, or null.
 */
function unwrapSorryPage(url) {
  try {
    const u = new URL(url);
    if (u.pathname !== "/sorry/index") return null;
    const cont = u.searchParams.get("continue");
    if (cont) return cont;
  } catch {}
  return null;
}

function looksLikeMapsUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.startsWith("/maps") ||
      u.hostname === "maps.google.com" ||
      u.hostname.startsWith("maps.google.") ||
      u.searchParams.has("ftid") ||
      u.searchParams.has("cid") ||
      u.searchParams.has("place_id")
    );
  } catch {
    return false;
  }
}

/** Shut down the shared browser on process exit. */
function cleanup() {
  if (_browserPromise) {
    _browserPromise
      .then((b) => b.close())
      .catch(() => {});
    _browserPromise = null;
  }
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
