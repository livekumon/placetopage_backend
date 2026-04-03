import { User } from "../models/User.js";

/** Default list when ADMIN_USER_EMAILS is unset */
const DEFAULT_ADMIN_EMAILS = ["kcramkishore1@gmail.com"];

export function adminEmailList() {
  if (process.env.ADMIN_USER_EMAILS !== undefined) {
    return process.env.ADMIN_USER_EMAILS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [...DEFAULT_ADMIN_EMAILS];
}

export function isListedAdminEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return adminEmailList().includes(e);
}

/**
 * Sets isAdmin: true for listed emails already in the DB (idempotent).
 */
export async function promoteAdminUsers() {
  const emails = adminEmailList();
  if (!emails.length) return;

  const r = await User.updateMany({ email: { $in: emails } }, { $set: { isAdmin: true } });
  if (r.modifiedCount > 0) {
    console.log(`[admin] Set isAdmin for ${r.modifiedCount} user(s)`);
  }
}

/** If this user's email is in the admin list, set isAdmin (handles stale rows + promote ran before signup). */
export async function ensureUserIsAdminIfListed(userId) {
  const u = await User.findById(userId).select("email isAdmin").lean();
  if (!u?.email || u.isAdmin) return;
  if (!isListedAdminEmail(u.email)) return;
  await User.updateOne({ _id: userId }, { $set: { isAdmin: true } });
}
