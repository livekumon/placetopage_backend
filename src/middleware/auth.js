import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return "dev-insecure-jwt-secret-change-me";
  }
  return s;
}

export function signUserToken(userId) {
  return jwt.sign({ sub: String(userId) }, getSecret(), { expiresIn: "7d" });
}

/** Root operator session — not tied to a User document */
export function signAdminToken() {
  return jwt.sign({ role: "admin", sub: "admin" }, getSecret(), { expiresIn: "1d" });
}

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decoded = jwt.verify(auth.slice(7), getSecret());
    if (!decoded?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decoded = jwt.verify(auth.slice(7), getSecret());
    if (decoded?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired admin session" });
  }
}

/** Operator JWT (role admin) OR signed-in user with isAdmin (e.g. Google SSO) */
export async function requireAdminAccess(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decoded = jwt.verify(auth.slice(7), getSecret());
    if (decoded?.role === "admin") {
      return next();
    }
    if (decoded?.sub) {
      const user = await User.findById(decoded.sub).select("isAdmin").lean();
      if (user?.isAdmin) {
        req.userId = decoded.sub;
        return next();
      }
    }
    return res.status(403).json({ message: "Forbidden" });
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
