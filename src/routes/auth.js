import { Router } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { User } from "../models/User.js";
import { requireAuth, signUserToken } from "../middleware/auth.js";
import { recordLoginEvent } from "../services/appStats.js";
import { ensureUserIsAdminIfListed, isListedAdminEmail } from "../services/promoteAdmins.js";

const router = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────

function userResponse(user) {
  const plain = user?.toObject?.() ?? user;
  return {
    id: String(plain._id),
    email: plain.email,
    name: plain.name,
    picture: plain.picture,
    creditsRemaining: plain.creditsRemaining,
    publishingCredits: plain.publishingCredits ?? 0,
    isAdmin: Boolean(plain.isAdmin),
    /** When true, backend allows deploy without PayPal (local/dev: SKIP_PUBLISH_PAYMENT=true) */
    skipPublishPayment: process.env.SKIP_PUBLISH_PAYMENT === "true",
    createdAt: plain.createdAt,
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

// ── Email / Password auth ─────────────────────────────────────────────────────

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ field: "name", message: "Full name is required." });
    }
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ field: "email", message: "A valid email address is required." });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ field: "password", message: "Password must be at least 8 characters." });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({
        field: "email",
        message: "An account with this email already exists. Sign in instead.",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const emailNorm = String(email).toLowerCase().trim();
    const user = await User.create({
      name: String(name).trim(),
      email: emailNorm,
      passwordHash,
      isAdmin: isListedAdminEmail(emailNorm),
    });

    const token = signUserToken(user._id);
    res.status(201).json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });

    // Same error for "not found" and "wrong password" — prevents email enumeration
    const invalid = () =>
      res.status(401).json({ field: "password", message: "Incorrect email or password." });

    if (!user) return invalid();
    if (!user.passwordHash) {
      // Account was created via Google SSO — no password set
      return res.status(401).json({
        field: "password",
        message: "This account uses Google Sign-In. Use the 'Continue with Google' button below.",
      });
    }

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) return invalid();

    await ensureUserIsAdminIfListed(user._id);
    await recordLoginEvent();
    const token = signUserToken(user._id);
    res.json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

// ── Google SSO auth ───────────────────────────────────────────────────────────

function getGoogleClient() {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  return new OAuth2Client(id);
}

async function verifyGoogleCredential(credential) {
  const client = getGoogleClient();
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new Error("Invalid Google token payload");
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || "",
    picture: payload.picture || "",
  };
}

// Google login — also links accounts where the email already exists (email/password user
// who later clicks "Sign in with Google")
router.post("/google/login", async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: "credential is required" });

    const profile = await verifyGoogleCredential(credential);

    let user = await User.findOne({ googleId: profile.googleId });

    if (!user) {
      // Try to find by email — link the Google account to an existing email/password account
      user = await User.findOne({ email: profile.email });
      if (!user) {
        return res.status(404).json({
          message: "No account found. Please register first.",
        });
      }
      // Link Google ID to the existing account
      user.googleId = profile.googleId;
    }

    user.name = profile.name || user.name;
    user.picture = profile.picture || user.picture;
    await user.save();

    await ensureUserIsAdminIfListed(user._id);
    await recordLoginEvent();
    const token = signUserToken(user._id);
    res.json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

// Google register — also handles case where account already exists (auto-signs in)
router.post("/google/register", async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: "credential is required" });

    const profile = await verifyGoogleCredential(credential);

    // Check for existing account (by googleId or email)
    let user = await User.findOne({
      $or: [{ googleId: profile.googleId }, { email: profile.email }],
    });

    if (user) {
      // Account already exists — link Google ID if not set, then sign in
      if (!user.googleId) user.googleId = profile.googleId;
      user.name = profile.name || user.name;
      user.picture = profile.picture || user.picture;
      await user.save();
      await ensureUserIsAdminIfListed(user._id);
      await recordLoginEvent();
      const token = signUserToken(user._id);
      return res.json({ token, user: userResponse(user) });
    }

    user = await User.create({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      isAdmin: isListedAdminEmail(profile.email),
    });

    const token = signUserToken(user._id);
    res.status(201).json({ token, user: userResponse(user) });
  } catch (e) {
    next(e);
  }
});

// ── Session ───────────────────────────────────────────────────────────────────

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(401).json({ message: "User not found" });
    res.json(userResponse(user));
  } catch (e) {
    next(e);
  }
});

export default router;
