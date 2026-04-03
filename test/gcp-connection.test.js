/**
 * Integration test: GCS bucket + credentials.
 * Loads backend/.env before importing gcpStorage (env must be set first).
 *
 * Run from backend/: npm run test:gcs
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const { verifyGcsConnection } = await import("../src/services/gcpStorage.js");

function hasGcsEnv() {
  return Boolean(process.env.GCS_BUCKET_NAME);
}

function hasCredentialsHint() {
  return Boolean(
    process.env.GCP_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

describe("GCS bucket connection", () => {
  test("skips when GCS_BUCKET_NAME is unset", async (t) => {
    if (hasGcsEnv()) {
      t.skip();
      return;
    }
    await assert.rejects(
      () => verifyGcsConnection(),
      /GCS_BUCKET_NAME is not configured/
    );
  });

  test("connects and reads bucket metadata with configured credentials", async (t) => {
    if (!hasGcsEnv()) {
      t.skip("Set GCS_BUCKET_NAME (and GCP_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS) in .env");
      return;
    }
    if (!hasCredentialsHint()) {
      t.skip(
        "Set GCP_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS so credentials are explicit in CI/local"
      );
      return;
    }

    const info = await verifyGcsConnection();
    assert.equal(typeof info.bucketName, "string");
    assert.ok(info.bucketName.length > 0);
    assert.ok(info.location, "expected location from bucket metadata");
  });
});
