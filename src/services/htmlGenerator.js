// ── Theme definitions ─────────────────────────────────────────────────────────

const THEMES = {
  light: {
    bg: "#ffffff",
    surface: "#f8fafc",
    surfaceAlt: "#f1f5f9",
    text: "#0f172a",
    textMuted: "#64748b",
    textLight: "#94a3b8",
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    primaryText: "#ffffff",
    accent: "#0ea5e9",
    border: "#e2e8f0",
    heroOverlay: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.72) 100%)",
    cardBg: "#ffffff",
    cardShadow: "0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.05)",
    starColor: "#f59e0b",
    navBg: "rgba(255,255,255,0.92)",
    navText: "#0f172a",
    navBorder: "rgba(15,23,42,0.08)",
    headingFont: "'Playfair Display', Georgia, serif",
    bodyFont: "'Inter', -apple-system, system-ui, sans-serif",
    googleFonts: "Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;600;700",
  },
  dark: {
    bg: "#0a0f1e",
    surface: "#111827",
    surfaceAlt: "#0a0f1e",
    text: "#f0f4ff",
    textMuted: "#8b9cc8",
    textLight: "#4a5568",
    primary: "#6366f1",
    primaryHover: "#4f46e5",
    primaryText: "#ffffff",
    accent: "#38bdf8",
    border: "#1e2d4a",
    heroOverlay: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.08) 35%, rgba(0,0,0,0.52) 65%, rgba(0,0,0,0.80) 100%)",
    cardBg: "#111827",
    cardShadow: "0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)",
    starColor: "#fbbf24",
    navBg: "rgba(10,15,30,0.95)",
    navText: "#f0f4ff",
    navBorder: "rgba(255,255,255,0.06)",
    headingFont: "'Playfair Display', Georgia, serif",
    bodyFont: "'Inter', -apple-system, system-ui, sans-serif",
    googleFonts: "Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;600;700",
  },
  bold: {
    bg: "#09090b",
    surface: "#18181b",
    surfaceAlt: "#09090b",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textLight: "#52525b",
    primary: "#f97316",
    primaryHover: "#ea580c",
    primaryText: "#ffffff",
    accent: "#fbbf24",
    border: "#27272a",
    heroOverlay: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 35%, rgba(0,0,0,0.50) 65%, rgba(0,0,0,0.78) 100%)",
    cardBg: "#18181b",
    cardShadow: "0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)",
    starColor: "#fbbf24",
    navBg: "rgba(9,9,11,0.97)",
    navText: "#fafafa",
    navBorder: "rgba(255,255,255,0.06)",
    headingFont: "'Oswald', Impact, sans-serif",
    bodyFont: "'Inter', -apple-system, system-ui, sans-serif",
    googleFonts: "Oswald:wght@500;700&family=Inter:wght@400;500;600;700",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  return "★".repeat(Math.max(0, Math.min(r, 5))) + "☆".repeat(Math.max(0, 5 - r));
}

function initials(name = "") {
  return String(name).trim()[0]?.toUpperCase() ?? "?";
}

// ── Main generator ────────────────────────────────────────────────────────────

export function generateSiteHtml({ name, theme = "light", placeData = {} }) {
  const t = THEMES[theme] || THEMES.light;

  const {
    address = "",
    phone = "",
    website = "",
    description = "",
    tagline = "",
    heroHeadline = "",
    ctaText = "Visit Us",
    seoDescription = "",
    highlights = [],
    rating = null,
    reviewCount = 0,
    openingHours = [],
    reviews = [],
    photoUrl = "",
    photos = [],
    aboutPhotoUrl = "",
    mapsUrl = "",
    category = "Business",
    /** Parallel to `reviews`: false = hidden. Legacy: `reviewsCustom` enabled flags. */
    reviewsEnabled = null,
    reviewsCustom = null,
    footerCopyright = "",
    footerAttribution = "",
    showFooterAttribution = true,
  } = placeData;

  // Normalise photos array — always include photoUrl as first item (cap at 20 for gallery + hero)
  const MAX_PLACE_PHOTOS = 20;
  const allPhotos = [
    ...(photoUrl ? [photoUrl] : []),
    ...(photos || []).filter((p) => p && p !== photoUrl),
  ].slice(0, MAX_PLACE_PHOTOS);

  const heroPhoto = allPhotos[0] || "";
  const trimmedAbout = String(aboutPhotoUrl || "").trim();
  const aboutImg =
    trimmedAbout ||
    allPhotos[1] ||
    allPhotos[0] ||
    "";

  // Gallery: photos after hero, excluding the About image so it is not duplicated
  let galleryPhotos = allPhotos.slice(1);
  galleryPhotos = galleryPhotos.filter((u) => u && u !== aboutImg);
  const hasGallery = galleryPhotos.length > 0;

  const displayName = esc(name);
  const heroText = esc(heroHeadline || tagline || name);
  const subText = esc(tagline || description?.slice(0, 120) || "");
  const mapsLink = mapsUrl || `https://maps.google.com/?q=${encodeURIComponent((name || "") + " " + (address || ""))}`;
  const cleanWebsite = website ? website.replace(/^https?:\/\/(www\.)?/, "") : "";
  const telHref = phone ? `tel:${phone.replace(/[\s()\-+]/g, "")}` : null;

  // ── Hero slideshow slides ─────────────────────────────────────────────────
  const slideshowPhotos = allPhotos.slice(0, Math.min(6, allPhotos.length));
  const slideDuration = 5; // seconds per slide
  const totalDuration = slideDuration * slideshowPhotos.length;

  const slideKeyframes = slideshowPhotos.length > 1
    ? slideshowPhotos.map((_, i) => {
        const pct = (i / slideshowPhotos.length) * 100;
        const end = ((i + 1) / slideshowPhotos.length) * 100;
        const fadeIn = pct;
        const hold = pct + (end - pct) * 0.75;
        return `@keyframes slide-${i} {
  0%   { opacity: ${i === 0 ? 1 : 0}; }
  ${fadeIn.toFixed(1)}% { opacity: 1; }
  ${hold.toFixed(1)}% { opacity: 1; }
  ${end.toFixed(1)}% { opacity: 0; }
  100% { opacity: ${i === 0 ? 1 : 0}; }
}`;
      }).join("\n")
    : "";

  const slidesDivs = slideshowPhotos.map((url, i) => {
    const delay = i * slideDuration;
    const style = slideshowPhotos.length > 1
      ? `style="background-image:url('${esc(url)}');animation:slide-${i} ${totalDuration}s ${delay}s infinite;"`
      : `style="background-image:url('${esc(url)}')"`;
    return `<div class="hero-slide" ${style}></div>`;
  }).join("\n    ");

  // ── Gallery HTML ──────────────────────────────────────────────────────────
  const galleryHtml = hasGallery
    ? `<section class="gallery-section" aria-label="Photo gallery">
    <div class="container">
      <p class="section-label">Gallery</p>
      <h2 class="section-title">A look inside</h2>
      <div class="gallery-grid">
        ${galleryPhotos.map((url, i) => `
        <div class="gallery-item ${i === 0 && galleryPhotos.length >= 3 ? 'gallery-item--featured' : ''}">
          <img src="${esc(url)}" alt="${displayName} photo ${i + 2}" loading="lazy" class="gallery-img">
        </div>`).join("")}
      </div>
    </div>
  </section>`
    : "";

  // ── Opening hours rows ────────────────────────────────────────────────────
  // Parse hours into { day, time } objects for both the modal table and today detection
  const hoursParsed = (openingHours || []).map((h) => {
    const colonIdx = h.indexOf(":");
    const day = colonIdx > -1 ? h.slice(0, colonIdx).trim() : h.trim();
    const time = colonIdx > -1 ? h.slice(colonIdx + 1).trim() : "";
    return { day, time };
  });

  // Modal table rows — today highlighted via JS at runtime (data-day attribute)
  const hoursModalRows = hoursParsed.map(({ day, time }) =>
    `<tr data-day="${esc(day)}"><td class="hm-day">${esc(day)}</td><td class="hm-time">${esc(time)}</td></tr>`
  ).join("");

  // Keep hoursRows for any legacy use (no longer used in footer display)
  const hoursRows = hoursParsed.map(({ day, time }) =>
    `<tr><td class="hours-day">${esc(day)}</td><td class="hours-time">${esc(time)}</td></tr>`
  ).join("");

  // ── Review cards: copy from Google `reviews`; visibility via `reviewsEnabled` (legacy: `reviewsCustom`) ─
  const normalizeReviewEntry = (r) => ({
    author: r?.author || "",
    text: r?.text || "",
    relativeTime: r?.relativeTime || "",
    rating: r?.rating ?? 5,
    authorPhoto: r?.authorPhoto || "",
  });
  const baseReviews = (reviews || []).map(normalizeReviewEntry);
  let enabledAt = baseReviews.map(() => true);
  if (Array.isArray(reviewsEnabled) && reviewsEnabled.length === baseReviews.length) {
    enabledAt = reviewsEnabled.map((v) => v !== false);
  } else if (Array.isArray(reviewsCustom) && reviewsCustom.length > 0) {
    enabledAt = baseReviews.map((_, i) => reviewsCustom[i]?.enabled !== false);
  }

  const reviewCardsParts = [];
  for (let i = 0; i < baseReviews.length; i++) {
    if (reviewCardsParts.length >= 6) break;
    const r = baseReviews[i];
    if (!enabledAt[i]) continue;
    const t = String(r.text || "").trim();
    if (!t || t.length <= 10) continue;
    reviewCardsParts.push({ r });
  }

  const reviewCardsHtml = reviewCardsParts
    .map(({ r }) => `
    <article class="review-card" aria-label="Review by ${esc(r.author)}">
      <div class="review-header">
        ${r.authorPhoto
          ? `<img class="review-avatar" src="${esc(r.authorPhoto)}" alt="${esc(r.author)}" loading="lazy" width="40" height="40">`
          : `<div class="review-avatar" aria-hidden="true">${initials(r.author)}</div>`}
        <div class="review-meta">
          <span class="review-author">${esc(r.author)}</span>
          <span class="review-time">${esc(r.relativeTime)}</span>
        </div>
        <span class="review-stars" aria-label="${r.rating} out of 5 stars">${stars(r.rating)}</span>
      </div>
      <p class="review-text">${esc(r.text)}</p>
    </article>`).join("");

  const year = new Date().getFullYear();
  const footerCopyDefault = `© ${year} ${name || "Site"}`;
  const footerCopyRaw = String(footerCopyright || "").trim() || footerCopyDefault;
  const footerCopyEscaped = esc(footerCopyRaw);
  const attributionRaw =
    String(footerAttribution ?? "").trim() || "Made with Place to Page";
  const attributionEscaped = esc(attributionRaw);
  const showAttrib = showFooterAttribution !== false;

  // ── Highlight items ───────────────────────────────────────────────────────
  const highlightItems = (highlights || []).map((h) => `
    <li class="highlight-item">
      <span class="highlight-icon" aria-hidden="true">✦</span>
      <span>${esc(h)}</span>
    </li>`).join("");

  // ── CSS ───────────────────────────────────────────────────────────────────
  const css = `
    /* ── Reset & base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: ${t.bg};
      --surface: ${t.surface};
      --surface-alt: ${t.surfaceAlt};
      --text: ${t.text};
      --text-muted: ${t.textMuted};
      --text-light: ${t.textLight};
      --primary: ${t.primary};
      --primary-hover: ${t.primaryHover};
      --primary-text: ${t.primaryText};
      --accent: ${t.accent};
      --border: ${t.border};
      --card-bg: ${t.cardBg};
      --card-shadow: ${t.cardShadow};
      --star: ${t.starColor};
      --nav-bg: ${t.navBg};
      --nav-text: ${t.navText};
      --nav-border: ${t.navBorder};
      --heading-font: ${t.headingFont};
      --body-font: ${t.bodyFont};
      --radius-sm: 0.5rem;
      --radius: 0.875rem;
      --radius-lg: 1.5rem;
    }
    html { scroll-behavior: smooth; font-size: 16px; -webkit-text-size-adjust: 100%; }
    body {
      font-family: var(--body-font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    img { max-width: 100%; height: auto; display: block; }
    a { color: inherit; text-decoration: none; }

    /* ── NAV ── */
    .nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 200;
      display: flex; align-items: center; justify-content: space-between;
      height: 64px; padding: 0 1.25rem;
      background: transparent;
      border-bottom: 1px solid transparent;
      transition: background 0.35s ease, border-color 0.35s ease, backdrop-filter 0.35s ease;
    }
    /* Scroll-triggered nav fill */
    .nav.scrolled {
      background: var(--nav-bg);
      backdrop-filter: blur(16px) saturate(1.8);
      -webkit-backdrop-filter: blur(16px) saturate(1.8);
      border-bottom-color: var(--nav-border);
    }
    .nav-brand {
      font-family: var(--heading-font);
      font-size: 1.2rem; font-weight: 700;
      color: #fff; /* always white over photo */
      letter-spacing: -0.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 60vw;
      text-shadow: 0 1px 8px rgba(0,0,0,0.5);
      transition: color 0.35s;
    }
    .nav.scrolled .nav-brand { color: var(--nav-text); text-shadow: none; }
    .nav-right { display: flex; align-items: center; gap: 0.75rem; }
    .nav-cta {
      display: inline-flex; align-items: center; gap: 0.35rem;
      background: rgba(255,255,255,0.18); color: #fff;
      border: 1.5px solid rgba(255,255,255,0.55);
      border-radius: 999px; padding: 0.55rem 1.25rem;
      font-family: var(--body-font); font-size: 0.875rem; font-weight: 600;
      cursor: pointer; white-space: nowrap; min-height: 44px;
      backdrop-filter: blur(4px);
      transition: background 0.2s, border-color 0.2s, transform 0.15s;
    }
    .nav-cta:hover { background: rgba(255,255,255,0.28); border-color: rgba(255,255,255,0.9); }
    .nav.scrolled .nav-cta {
      background: var(--primary); color: var(--primary-text);
      border-color: transparent;
    }
    .nav.scrolled .nav-cta:hover { background: var(--primary-hover); transform: translateY(-1px); }

    /* ── HERO ── (one viewport tall; background never stretches with content) */
    .hero {
      position: relative;
      box-sizing: border-box;
      min-height: 100vh;
      height: 100vh;
      max-height: 100vh;
      min-height: 100svh;
      height: 100svh;
      max-height: 100svh;
      display: flex; align-items: flex-end;
      padding: 5rem 1.25rem 3.5rem;
      overflow: hidden;
      background: #111; /* fallback while images load */
    }
    .hero-slide {
      position: absolute; inset: -4px; /* bleed past edges so blur doesn't show white border */
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      will-change: opacity;
      transform: scale(1.06); /* extra scale covers the inset bleed */
      /* Slight blur removes any text/signage from the photo; brightness darkens it
         so the gradient overlay never has to fight readable text in the image */
      filter: blur(2.5px) brightness(0.82) saturate(1.1);
      ${slideshowPhotos.length > 1 ? "" : "opacity: 1;"}
    }
    /* Ken-Burns subtle zoom on single photo */
    ${slideshowPhotos.length <= 1 ? `.hero-slide {
      animation: kb-zoom 14s ease-in-out infinite alternate;
    }
    @keyframes kb-zoom {
      from { transform: scale(1.04) ; filter: blur(2.5px) brightness(0.82) saturate(1.1); }
      to   { transform: scale(1.1)  ; filter: blur(2.5px) brightness(0.78) saturate(1.1); }
    }` : ""}
    .hero-overlay {
      position: absolute; inset: 0; z-index: 1;
      background: ${t.heroOverlay};
    }
    .hero-content {
      position: relative; z-index: 2;
      width: 100%; max-width: 760px;
      flex-shrink: 1;
      min-height: 0;
      max-height: min(92vh, calc(100svh - 6rem));
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 0.4rem;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.22);
      color: rgba(255,255,255,0.9);
      font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 999px; padding: 0.4rem 1rem;
      margin-bottom: 1.25rem;
      backdrop-filter: blur(4px);
    }
    .hero h1 {
      font-family: var(--heading-font);
      font-size: clamp(2.2rem, 7vw, 4.5rem);
      font-weight: 900; line-height: 1.06;
      color: #fff;
      text-shadow: 0 2px 24px rgba(0,0,0,0.4);
      margin-bottom: 1rem;
      letter-spacing: -0.02em;
    }
    .hero-sub {
      font-size: clamp(1rem, 2.5vw, 1.2rem);
      color: rgba(255,255,255,0.82);
      margin-bottom: 2rem; max-width: 540px; line-height: 1.7;
    }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 0.875rem; margin-bottom: 2rem; }
    .btn-hero-primary {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: var(--primary); color: var(--primary-text);
      border: none; border-radius: 999px;
      padding: 0.9rem 2rem; font-family: var(--body-font);
      font-size: 1rem; font-weight: 700; cursor: pointer;
      min-height: 52px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
      transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
    }
    .btn-hero-primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: 0 6px 32px rgba(0,0,0,0.4); }
    .btn-hero-outline {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: rgba(255,255,255,0.1); color: #fff;
      border: 1.5px solid rgba(255,255,255,0.5);
      border-radius: 999px; padding: 0.9rem 1.75rem;
      font-family: var(--body-font); font-size: 1rem; font-weight: 600;
      cursor: pointer; min-height: 52px;
      backdrop-filter: blur(4px);
      transition: background 0.2s, border-color 0.2s;
    }
    .btn-hero-outline:hover { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.8); }
    .hero-rating {
      display: inline-flex; align-items: center; gap: 0.625rem;
      background: rgba(255,255,255,0.1); backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px; padding: 0.45rem 1.1rem;
      color: #fff; font-size: 0.875rem; font-weight: 500;
    }
    .hero-rating-stars { color: var(--star); font-size: 0.95rem; }

    /* ── PHOTO DOTS (slideshow indicators) ── */
    ${slideshowPhotos.length > 1 ? `.hero-dots {
      display: flex; gap: 6px; margin-top: 1.5rem;
    }
    .hero-dot {
      width: 6px; height: 6px; border-radius: 999px;
      background: rgba(255,255,255,0.4);
    }
    .hero-dot--active { width: 20px; background: #fff; }` : ""}

    /* ── LAYOUT UTILITIES ── */
    .container { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 1.25rem; }
    section { padding: 4rem 0; }
    .section-label {
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.18em;
      text-transform: uppercase; color: var(--primary); margin-bottom: 0.75rem;
    }
    .section-title {
      font-family: var(--heading-font);
      font-size: clamp(1.75rem, 4vw, 2.75rem);
      font-weight: 700; line-height: 1.15;
      color: var(--text); letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }
    .section-sub {
      font-size: 1.05rem; color: var(--text-muted);
      max-width: 600px; line-height: 1.8;
    }
    .divider { border: none; border-top: 1px solid var(--border); margin: 0; }

    /* ── ABOUT ── */
    .about { background: var(--surface); }
    .about-grid {
      display: grid; grid-template-columns: 1fr;
      gap: 2.5rem; align-items: center;
    }
    .about-photo {
      width: 100%; aspect-ratio: 4/3;
      object-fit: cover; border-radius: var(--radius-lg);
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }
    .about-photo-placeholder {
      width: 100%; aspect-ratio: 4/3;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, ${t.primary}22, ${t.accent}22);
      display: flex; align-items: center; justify-content: center;
      font-size: 4rem; border: 1px solid var(--border);
    }
    .highlights-list {
      list-style: none; display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem; margin-top: 1.5rem;
    }
    .highlight-item {
      display: flex; align-items: flex-start; gap: 0.6rem;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 0.875rem; font-weight: 500; color: var(--text);
    }
    .highlight-icon { color: var(--primary); font-size: 0.9rem; flex-shrink: 0; margin-top: 0.1rem; }

    /* ── GALLERY ── */
    .gallery-section { background: var(--bg); }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      margin-top: 2rem;
    }
    .gallery-item { overflow: hidden; border-radius: var(--radius); }
    .gallery-img {
      width: 100%; aspect-ratio: 4/3;
      object-fit: cover;
      transition: transform 0.4s ease;
      will-change: transform;
    }
    .gallery-item:hover .gallery-img { transform: scale(1.04); }

    /* ── FOOTER ── */
    .footer {
      background: var(--surface);
      border-top: 1px solid var(--border);
    }
    /* Top: 3-column info grid */
    .footer-top {
      max-width: 1120px; margin: 0 auto;
      padding: 3rem 1.25rem 2.5rem;
      display: grid; grid-template-columns: 1fr;
      gap: 2.5rem;
    }
    /* Business identity column */
    .footer-brand-col {}
    .footer-name {
      font-family: var(--heading-font);
      font-size: 1.5rem; font-weight: 700; color: var(--text);
      letter-spacing: -0.01em; margin-bottom: 0.4rem;
    }
    .footer-tagline { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5; }
    .footer-rating-chip {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: ${t.primary}12; border: 1px solid ${t.primary}25;
      border-radius: 999px; padding: 0.3rem 0.875rem;
      font-size: 0.8rem; font-weight: 600; color: var(--text-muted);
    }
    .footer-rating-stars { color: var(--star); }
    /* Contact column */
    .footer-contact-col {}
    .footer-col-heading {
      font-size: 0.68rem; font-weight: 700;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--primary); margin-bottom: 1rem;
    }
    .footer-contact-list { list-style: none; display: flex; flex-direction: column; gap: 0.625rem; }
    .footer-contact-list li { display: flex; align-items: flex-start; gap: 0.625rem; }
    .footer-contact-icon { font-size: 0.95rem; flex-shrink: 0; margin-top: 0.05rem; opacity: 0.75; }
    .footer-contact-text { font-size: 0.875rem; color: var(--text-muted); line-height: 1.5; }
    .footer-contact-text a { color: var(--text-muted); transition: color 0.15s; }
    .footer-contact-text a:hover { color: var(--primary); }
    /* Hours column — collapsed link */
    .footer-hours-col {}
    .hours-toggle-btn {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: none; border: none; cursor: pointer; padding: 0;
      font-family: var(--body-font); font-size: 0.875rem;
      font-weight: 500; color: var(--text-muted);
      transition: color 0.15s;
      text-decoration: none;
    }
    .hours-toggle-btn:hover { color: var(--primary); }
    .hours-toggle-btn:hover .hours-toggle-arrow { transform: translateX(3px); }
    .hours-toggle-arrow { transition: transform 0.2s; font-style: normal; }
    .hours-today-hint {
      display: block; font-size: 0.78rem; color: var(--text-light);
      margin-top: 0.3rem;
    }

    /* ── HOURS MODAL ── */
    .hours-modal-overlay {
      position: fixed; inset: 0; z-index: 999;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 1.25rem;
      opacity: 0; pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .hours-modal-overlay.open {
      opacity: 1; pointer-events: auto;
    }
    .hours-modal-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      width: 100%; max-width: 400px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.25);
      transform: translateY(20px) scale(0.97);
      transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
      opacity: 0;
    }
    .hours-modal-overlay.open .hours-modal-box {
      transform: translateY(0) scale(1); opacity: 1;
    }
    .hours-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.25rem 1.5rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .hours-modal-title {
      font-family: var(--heading-font);
      font-size: 1.15rem; font-weight: 700; color: var(--text);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .hours-modal-close {
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      background: var(--surface-alt); border: 1px solid var(--border);
      border-radius: 50%; cursor: pointer; font-size: 0.85rem;
      color: var(--text-muted); transition: background 0.15s, color 0.15s;
    }
    .hours-modal-close:hover { background: var(--border); color: var(--text); }
    .hours-modal-body { padding: 1.25rem 1.5rem 1.5rem; }
    .hours-modal-table { width: 100%; border-collapse: collapse; }
    .hours-modal-table tr { border-bottom: 1px solid var(--border); }
    .hours-modal-table tr:last-child { border-bottom: none; }
    .hours-modal-table td {
      padding: 0.65rem 0;
      font-size: 0.875rem;
    }
    .hours-modal-table .hm-day {
      color: var(--text-muted); font-weight: 500;
      width: 45%; padding-right: 1rem;
    }
    .hours-modal-table .hm-time {
      color: var(--text); font-weight: 500; text-align: right;
    }
    .hours-modal-table tr.hm-today .hm-day,
    .hours-modal-table tr.hm-today .hm-time {
      color: var(--primary); font-weight: 700;
    }
    .hours-modal-table tr.hm-today td {
      background: ${t.primary}0c;
      border-radius: 0.375rem;
    }
    .hm-today-badge {
      display: inline-block;
      background: var(--primary); color: var(--primary-text);
      font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      border-radius: 999px; padding: 0.15rem 0.5rem;
      margin-left: 0.4rem; vertical-align: middle;
    }
    /* Bottom bar */
    .footer-bottom {
      border-top: 1px solid var(--border);
      padding: 1rem 1.25rem;
      display: flex; flex-wrap: wrap; gap: 0.75rem;
      align-items: center; justify-content: space-between;
      max-width: 1120px; margin: 0 auto;
    }
    .footer-copy { font-size: 0.78rem; color: var(--text-light); }
    .footer-bottom-links { display: flex; gap: 1.25rem; flex-wrap: wrap; }
    .footer-bottom-links a { font-size: 0.78rem; color: var(--text-light); transition: color 0.15s; }
    .footer-bottom-links a:hover { color: var(--primary); }

    /* ── REVIEWS ── */
    .reviews-section { background: var(--surface); }
    .reviews-summary {
      display: flex; align-items: center; gap: 1.25rem;
      margin-bottom: 2.5rem;
      flex-wrap: wrap;
    }
    .reviews-score {
      font-family: var(--heading-font);
      font-size: 4.5rem; font-weight: 900;
      color: var(--text); line-height: 1;
    }
    .reviews-score-meta { display: flex; flex-direction: column; gap: 0.3rem; }
    .reviews-score-stars { color: var(--star); font-size: 1.5rem; }
    .reviews-count { font-size: 0.85rem; color: var(--text-muted); }
    .reviews-scroll {
      display: grid; grid-template-columns: 1fr;
      gap: 1rem;
    }
    .review-card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.375rem;
      box-shadow: var(--card-shadow);
      break-inside: avoid;
    }
    .review-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.875rem; }
    .review-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      object-fit: cover; background: ${t.primary}22;
      color: var(--primary); font-weight: 700; font-size: 1rem;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--border);
    }
    .review-meta { flex: 1; min-width: 0; }
    .review-author { display: block; font-weight: 600; font-size: 0.9rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .review-time { font-size: 0.75rem; color: var(--text-muted); }
    .review-stars { color: var(--star); font-size: 0.9rem; flex-shrink: 0; white-space: nowrap; }
    .review-text {
      font-size: 0.9rem; color: var(--text-muted); line-height: 1.7;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
    }

    /* ── CTA ── */
    .cta-section { background: var(--bg); text-align: center; }
    .cta-box {
      background: linear-gradient(135deg, ${t.primary}14 0%, ${t.accent}0a 100%);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 3.5rem 1.5rem;
      max-width: 680px; margin: 0 auto;
    }
    .cta-box .section-title { margin-bottom: 0.75rem; }
    .cta-box .section-sub { margin: 0 auto 2rem; }
    .cta-actions { display: flex; flex-wrap: wrap; gap: 0.875rem; justify-content: center; }
    .btn-primary {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: var(--primary); color: var(--primary-text);
      border: none; border-radius: 999px;
      padding: 0.9rem 2rem;
      font-family: var(--body-font); font-size: 1rem; font-weight: 700;
      cursor: pointer; min-height: 52px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      transition: background 0.2s, transform 0.15s;
    }
    .btn-primary:hover { background: var(--primary-hover); transform: translateY(-2px); }
    .btn-secondary {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: transparent; color: var(--text-muted);
      border: 1.5px solid var(--border);
      border-radius: 999px; padding: 0.9rem 1.75rem;
      font-family: var(--body-font); font-size: 1rem; font-weight: 600;
      cursor: pointer; min-height: 52px;
      transition: border-color 0.2s, color 0.2s;
    }
    .btn-secondary:hover { border-color: var(--primary); color: var(--primary); }

    /* ── FOOTER ── */
    .footer {
      background: var(--surface);
      border-top: 1px solid var(--border);
      padding: 3rem 1.25rem 2rem;
    }
    .footer-inner {
      max-width: 1120px; margin: 0 auto;
      display: flex; flex-direction: column; gap: 1.25rem;
      align-items: center; text-align: center;
    }
    .footer-brand {
      font-family: var(--heading-font);
      font-size: 1.4rem; font-weight: 700; color: var(--text);
    }
    .footer-address { font-size: 0.875rem; color: var(--text-muted); }
    .footer-links { display: flex; flex-wrap: wrap; gap: 1.25rem; justify-content: center; }
    .footer-links a { font-size: 0.85rem; color: var(--text-muted); transition: color 0.15s; }
    .footer-links a:hover { color: var(--primary); }
    .footer-copy { font-size: 0.78rem; color: var(--text-light); }

    /* ── TABLET: 640px ── */
    @media (min-width: 640px) {
      .container { padding: 0 1.75rem; }
      .hero { padding: 5.5rem 1.75rem 4rem; max-height: 100svh; height: 100svh; }
      .about-grid { grid-template-columns: 1fr 1fr; }
      .gallery-grid { grid-template-columns: repeat(3, 1fr); }
      .gallery-item--featured { grid-column: span 2; }
      .gallery-item--featured .gallery-img { aspect-ratio: 16/9; }
      .reviews-scroll { grid-template-columns: repeat(2, 1fr); }
      .footer-top { grid-template-columns: 1fr 1fr; }
      .footer-bottom { max-width: none; padding: 1rem 1.75rem; }
    }

    /* ── DESKTOP: 1024px ── */
    @media (min-width: 1024px) {
      .container { padding: 0 2rem; }
      section { padding: 5rem 0; }
      .hero { padding: 6rem 2rem 5rem; align-items: center; max-height: 100svh; height: 100svh; }
      .about-grid { gap: 4.5rem; }
      .gallery-grid { grid-template-columns: repeat(4, 1fr); }
      .gallery-item--featured { grid-column: span 2; }
      .reviews-scroll { grid-template-columns: repeat(3, 1fr); }
      .highlights-list { grid-template-columns: 1fr 1fr; }
      .footer-top { grid-template-columns: 1.4fr 1fr 1.2fr; padding: 3.5rem 2rem 3rem; }
      .footer-bottom { padding: 1rem 2rem; }
    }

    /* ── SLIDESHOW KEYFRAMES ── */
    ${slideKeyframes}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${displayName}</title>
  <meta name="description" content="${esc(seoDescription || description?.slice(0, 160) || name)}">
  <meta property="og:title" content="${displayName}">
  <meta property="og:description" content="${esc(seoDescription || description?.slice(0, 160) || "")}">
  ${heroPhoto ? `<meta property="og:image" content="${esc(heroPhoto)}">` : ""}
  <meta property="og:type" content="website">
  <meta name="theme-color" content="${t.primary}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${t.googleFonts}&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body>

  <!-- NAV -->
  <nav class="nav" role="navigation" aria-label="Main navigation">
    <a class="nav-brand" href="#" data-p2p-field="name">${displayName}</a>
    <div class="nav-right">
      <a class="nav-cta" href="#contact" data-p2p-field="ctaText">${esc(ctaText)}</a>
    </div>
  </nav>

  <!-- HERO -->
  <header class="hero" role="banner" data-p2p-field="thumbnailUrl">
    ${slidesDivs}
    <div class="hero-overlay" aria-hidden="true"></div>
    <div class="hero-content">
      <p class="hero-badge" data-p2p-field="category">${esc(category)}</p>
      <h1 data-p2p-field="heroHeadline">${heroText}</h1>
      ${subText ? `<p class="hero-sub" data-p2p-field="tagline">${subText}</p>` : ""}
      <div class="hero-actions">
        <a class="btn-hero-primary" href="#contact" data-p2p-field="ctaText">${esc(ctaText)}</a>
        <a class="btn-hero-outline" href="${esc(mapsLink)}" target="_blank" rel="noopener noreferrer">
          📍 Get directions
        </a>
      </div>
      ${rating ? `
      <div class="hero-rating">
        <span class="hero-rating-stars" aria-label="${rating} stars">${stars(rating)}</span>
        <strong>${rating}</strong>
        <span style="opacity:0.7">·</span>
        <span>${Number(reviewCount).toLocaleString()} reviews on Google</span>
      </div>` : ""}
      ${slideshowPhotos.length > 1 ? `
      <div class="hero-dots" aria-hidden="true">
        ${slideshowPhotos.map((_, i) => `<div class="hero-dot${i === 0 ? " hero-dot--active" : ""}"></div>`).join("")}
      </div>` : ""}
    </div>
  </header>

  <!-- ABOUT -->
  <section class="about" aria-labelledby="about-heading">
    <div class="container">
      <div class="about-grid">
        <div>
          <p class="section-label">About us</p>
          <h2 class="section-title" id="about-heading" data-p2p-field="name">${displayName}</h2>
          <p class="section-sub" data-p2p-field="description">${esc(description || tagline || "")}</p>
          ${highlights?.length > 0 ? `
          <ul class="highlights-list" aria-label="Key highlights">
            ${highlightItems}
          </ul>` : ""}
        </div>
        ${aboutImg
          ? `<img class="about-photo" src="${esc(aboutImg)}" alt="${displayName} — about us" loading="lazy" data-p2p-field="aboutPhotoUrl">`
          : `<div class="about-photo-placeholder" aria-hidden="true" data-p2p-field="aboutPhotoUrl">🏪</div>`}
      </div>
    </div>
  </section>

  <hr class="divider">

  <!-- PHOTO GALLERY -->
  ${galleryHtml}
  ${hasGallery ? '<hr class="divider">' : ""}

  <!-- REVIEWS -->
  ${reviewCardsHtml ? `
  <section class="reviews-section" aria-labelledby="reviews-heading">
    <div class="container">
      <p class="section-label">What customers say</p>
      ${rating ? `
      <div class="reviews-summary">
        <span class="reviews-score" aria-label="${rating} out of 5">${rating}</span>
        <div class="reviews-score-meta">
          <span class="reviews-score-stars" aria-hidden="true">${stars(rating)}</span>
          <span class="reviews-count">${Number(reviewCount).toLocaleString()} Google reviews</span>
        </div>
      </div>` : `<h2 class="section-title" id="reviews-heading">Customer Reviews</h2>`}
      <div class="reviews-scroll" role="list">
        ${reviewCardsHtml}
      </div>
    </div>
  </section>

  <hr class="divider">` : ""}

  <!-- CTA -->
  <section class="cta-section" id="contact" aria-labelledby="cta-heading">
    <div class="container">
      <div class="cta-box">
        <p class="section-label">Come visit us</p>
        <h2 class="section-title" id="cta-heading" data-p2p-field="name">Ready to experience ${displayName}?</h2>
        ${address ? `<p class="section-sub" data-p2p-field="mapsUrl">${esc(address)}</p>` : ""}
        <div class="cta-actions" style="margin-top:2rem">
          ${phone
            ? `<a class="btn-primary" href="${esc(telHref)}" data-p2p-field="ctaText">${esc(ctaText)}</a>`
            : `<a class="btn-primary" href="${esc(mapsLink)}" target="_blank" rel="noopener noreferrer" data-p2p-field="ctaText">${esc(ctaText)}</a>`}
          <a class="btn-secondary" href="${esc(mapsLink)}" target="_blank" rel="noopener noreferrer">
            View on Google Maps
          </a>
        </div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="footer" role="contentinfo">

    <!-- 3-column info: brand · contact · hours -->
    <div class="footer-top">

      <!-- Col 1: Brand -->
      <div class="footer-brand-col">
        <h3 class="footer-name" data-p2p-field="name">${displayName}</h3>
        ${tagline || description
          ? `<p class="footer-tagline" data-p2p-field="tagline">${esc((tagline || description || "").slice(0, 100))}</p>`
          : ""}
        ${rating ? `
        <div class="footer-rating-chip">
          <span class="footer-rating-stars">${stars(rating)}</span>
          <span>${rating} · ${Number(reviewCount).toLocaleString()} reviews</span>
        </div>` : ""}
      </div>

      <!-- Col 2: Contact -->
      <div class="footer-contact-col">
        <p class="footer-col-heading">Find us</p>
        <ul class="footer-contact-list">
          ${address ? `
          <li data-p2p-field="mapsUrl">
            <span class="footer-contact-icon">📍</span>
            <span class="footer-contact-text">
              <a href="${esc(mapsLink)}" target="_blank" rel="noopener noreferrer">${esc(address)}</a>
            </span>
          </li>` : ""}
          ${phone ? `
          <li data-p2p-field="phone">
            <span class="footer-contact-icon">📞</span>
            <span class="footer-contact-text"><a href="${esc(telHref)}">${esc(phone)}</a></span>
          </li>` : ""}
          ${website ? `
          <li data-p2p-field="website">
            <span class="footer-contact-icon">🌐</span>
            <span class="footer-contact-text">
              <a href="${esc(website)}" target="_blank" rel="noopener noreferrer">${esc(cleanWebsite)}</a>
            </span>
          </li>` : ""}
        </ul>
      </div>

      <!-- Col 3: Hours (collapsed — opens modal) -->
      ${openingHours?.length > 0 ? `
      <div class="footer-hours-col">
        <p class="footer-col-heading">Opening hours</p>
        <button class="hours-toggle-btn" onclick="document.getElementById('hours-modal').classList.add('open')" aria-haspopup="dialog">
          <span>🕐</span>
          <span>View opening hours</span>
          <i class="hours-toggle-arrow">→</i>
        </button>
        <span class="hours-today-hint" id="today-hint"></span>
      </div>` : ""}

    </div>

    <!-- Bottom bar -->
    <div class="footer-bottom">
      <p class="footer-copy" data-p2p-field="footerCopyright">${footerCopyEscaped}</p>
      <nav class="footer-bottom-links" aria-label="Footer links">
        ${mapsLink ? `<a href="${esc(mapsLink)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ""}
        ${website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
        ${showAttrib ? `<a href="#" style="color:var(--primary)" data-p2p-field="footerAttribution">${attributionEscaped}</a>` : ""}
      </nav>
    </div>

  </footer>

  ${openingHours?.length > 0 ? `
  <!-- HOURS MODAL -->
  <div id="hours-modal" class="hours-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="hours-modal-title">
    <div class="hours-modal-box">
      <div class="hours-modal-header">
        <h3 class="hours-modal-title" id="hours-modal-title">🕐 Opening Hours</h3>
        <button class="hours-modal-close" onclick="document.getElementById('hours-modal').classList.remove('open')" aria-label="Close">✕</button>
      </div>
      <div class="hours-modal-body">
        <table class="hours-modal-table" aria-label="Opening hours by day">
          <tbody>${hoursModalRows}</tbody>
        </table>
      </div>
    </div>
  </div>` : ""}

  <script>
    // Nav: transparent over hero, filled once scrolled past it
    (function () {
      var nav = document.querySelector('.nav');
      if (!nav) return;
      var hero = document.querySelector('.hero');
      function onScroll() {
        var threshold = hero ? hero.offsetHeight * 0.12 : 80;
        nav.classList.toggle('scrolled', window.scrollY > threshold);
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    })();

    // Slideshow dot indicator sync
    (function () {
      var dots = document.querySelectorAll('.hero-dot');
      if (!dots.length) return;
      var total = dots.length;
      var dur = ${slideDuration * 1000};
      var idx = 0;
      function activate(i) {
        dots.forEach(function (d, n) {
          d.style.width = n === i ? '20px' : '6px';
          d.style.background = n === i ? '#fff' : 'rgba(255,255,255,0.4)';
        });
      }
      activate(0);
      setInterval(function () { idx = (idx + 1) % total; activate(idx); }, dur);
    })();

    // Hours modal: highlight today's row + show today hint + close behaviours
    (function () {
      var modal = document.getElementById('hours-modal');
      if (!modal) return;

      // Day names to match Google's format (Monday, Tuesday, …)
      var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var todayName = DAY_NAMES[new Date().getDay()];

      // Highlight today in the modal table
      var rows = modal.querySelectorAll('tr[data-day]');
      rows.forEach(function (row) {
        if (row.getAttribute('data-day') === todayName) {
          row.classList.add('hm-today');
          var badge = document.createElement('span');
          badge.className = 'hm-today-badge';
          badge.textContent = 'Today';
          row.querySelector('.hm-day').appendChild(badge);
        }
      });

      // Show today's hours as a hint under the link
      var hint = document.getElementById('today-hint');
      if (hint) {
        var todayRow = modal.querySelector('tr.hm-today .hm-time');
        if (todayRow) hint.textContent = 'Today: ' + todayRow.textContent;
      }

      // Close on overlay click (but not box click)
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.remove('open');
      });

      // Close on Escape key
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') modal.classList.remove('open');
      });
    })();
  </script>

</body>
</html>`;
}
