import { Storage } from "@google-cloud/storage";
import { randomBytes } from "crypto";

let _storage = null;

function getStorage() {
  if (_storage) return _storage;
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const credentials = JSON.parse(raw.trim());
    _storage = new Storage({
      projectId: credentials.project_id,
      credentials,
    });
  } else {
    _storage = new Storage();
  }
  return _storage;
}

function extFromMime(mime) {
  const m = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return m[mime] || "jpg";
}

/**
 * Upload image bytes to GCS. Returns a public HTTPS URL.
 * Requires bucket IAM so objects are readable (see backend/.env.example).
 */
export async function uploadHeroImageBuffer({ buffer, contentType, userId }) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not configured");
  }

  const ext = extFromMime(contentType);
  const safeUser = String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
  const id = randomBytes(8).toString("hex");
  const objectPath = `heroes/${safeUser}/${Date.now()}-${id}.${ext}`;

  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
    resumable: false,
  });

  try {
    await file.makePublic();
  } catch (e) {
    console.warn(
      "gcpStorage: makePublic skipped (uniform bucket-level access?). Ensure the bucket allows public reads. ",
      e?.message
    );
  }

  const encodedPath = objectPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  const base =
    process.env.GCS_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    `https://storage.googleapis.com/${bucketName}`;
  return `${base}/${encodedPath}`;
}

export function isGcsConfigured() {
  return Boolean(process.env.GCS_BUCKET_NAME);
}

export function getGcsBucketName() {
  return process.env.GCS_BUCKET_NAME || null;
}

/** Prefix for objects uploaded by uploadHeroImageBuffer — must match streamHeroImageForUser checks */
function heroPathPrefixForUser(userId) {
  return `heroes/${String(userId).replace(/[^a-zA-Z0-9_-]/g, "")}/`;
}

/**
 * Stream a hero object to the response if it exists and belongs to userId.
 * Used when the bucket is private (uniform access) so the browser cannot load storage.googleapis.com URLs in <img>.
 */
export async function streamHeroImageForUser(res, objectPath, userId) {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    const e = new Error("GCS not configured");
    e.statusCode = 503;
    throw e;
  }
  const prefix = heroPathPrefixForUser(userId);
  if (
    !objectPath ||
    typeof objectPath !== "string" ||
    objectPath.includes("..") ||
    objectPath.startsWith("/") ||
    !objectPath.startsWith(prefix)
  ) {
    const e = new Error("Forbidden");
    e.statusCode = 403;
    throw e;
  }

  const file = getStorage().bucket(bucketName).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    const e = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }

  const [metadata] = await file.getMetadata();
  res.setHeader(
    "Content-Type",
    metadata.contentType || "application/octet-stream"
  );
  res.setHeader("Cache-Control", "private, max-age=300");

  const stream = file.createReadStream();
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
}

/**
 * Verifies that credentials (JSON or ADC) can read bucket metadata.
 * Does not upload or delete objects.
 */
export async function verifyGcsConnection() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not configured");
  }
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON.trim());
    } catch (e) {
      throw new Error(
        `GCP_SERVICE_ACCOUNT_JSON is not valid JSON: ${e?.message ?? e}`
      );
    }
  }
  const bucket = getStorage().bucket(bucketName);
  const [metadata] = await bucket.getMetadata();
  return {
    bucketName: metadata.name ?? bucketName,
    location: metadata.location,
    storageClass: metadata.storageClass,
  };
}
