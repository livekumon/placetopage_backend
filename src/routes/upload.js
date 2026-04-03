import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import {
  getGcsBucketName,
  isGcsConfigured,
  streamHeroImageForUser,
  uploadHeroImageBuffer,
} from "../services/gcpStorage.js";

const router = Router();

/** Public — lets the UI show or hide the upload control */
router.get("/status", (_req, res) => {
  res.json({
    uploadConfigured: isGcsConfigured(),
    bucket: getGcsBucketName(),
  });
});

/**
 * Authenticated read of a private GCS hero object (for dashboard / generator thumbnails).
 * Query: path=heroes/{userId}/filename.jpg
 */
router.get("/file", requireAuth, async (req, res, next) => {
  try {
    if (!isGcsConfigured()) {
      return res.status(503).json({ message: "Upload storage is not configured" });
    }
    const objectPath = String(req.query.path || "").trim();
    await streamHeroImageForUser(res, objectPath, req.userId);
  } catch (e) {
    const code = e.statusCode;
    if (code === 403) return res.status(403).json({ message: "Forbidden" });
    if (code === 404) return res.status(404).json({ message: "Not found" });
    if (code === 503) return res.status(503).json({ message: e.message });
    next(e);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."));
      return;
    }
    cb(null, true);
  },
});

router.post(
  "/hero",
  requireAuth,
  (req, res, next) => {
    if (!isGcsConfigured()) {
      return res.status(503).json({
        message:
          "Image upload is not configured. Set GCS_BUCKET_NAME and GCP credentials on the server (see backend/.env.example).",
        code: "UPLOAD_NOT_CONFIGURED",
      });
    }
    next();
  },
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5 MB)." : err.message || "Upload failed";
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file?.buffer) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const url = await uploadHeroImageBuffer({
        buffer: file.buffer,
        contentType: file.mimetype,
        userId: req.userId,
      });
      res.json({ url });
    } catch (e) {
      console.error(e);
      next(e);
    }
  }
);

export default router;
