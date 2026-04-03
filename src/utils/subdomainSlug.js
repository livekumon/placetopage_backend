/** Vercel/custom hostname segment: lowercase letters, digits, hyphens; no leading/trailing hyphen. */
export const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

/**
 * Turn an LLM phrase (1–3 words, spaces only, no hyphens in the model output) into a DNS-safe slug.
 */
export function slugFromLLMSubdomainWords(raw) {
  if (!raw || typeof raw !== "string") return "";
  const ascii = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const words = ascii
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  let slug = words.join("-").replace(/-+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  if (!slug) return "";
  if (slug.length > 63) {
    slug = slug.slice(0, 63).replace(/-+$/g, "").replace(/^-+/g, "");
  }
  if (!SUBDOMAIN_RE.test(slug)) return "";
  return slug;
}
