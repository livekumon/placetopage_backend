/**
 * Quick test: deploys a minimal static HTML page to Vercel using the token
 * in backend/.env and prints the live URL.
 *
 * Run with:  node test-vercel-api.js
 */

import "dotenv/config";
import { deployToVercel } from "./src/services/vercelDeploy.js";

const token = process.env.VERCEL_TOKEN;
if (!token || token.startsWith("your-")) {
  console.error("❌  VERCEL_TOKEN is not set in backend/.env");
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Place to Page — Vercel test</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
    h1   { font-size: 2rem; margin-bottom: 0.5rem; color: #818cf8; }
    p    { color: #94a3b8; }
  </style>
</head>
<body>
  <div>
    <h1>✅ Vercel deployment works!</h1>
    <p>Place to Page · test deployment · ${new Date().toISOString()}</p>
  </div>
</body>
</html>`;

console.log("🚀  Deploying test page to Vercel…");
try {
  const result = await deployToVercel({ name: "p2p-test", html, token });
  console.log("\n✅  Success!");
  console.log("   Deployment ID :", result.deploymentId);
  console.log("   Live URL       :", result.url);
  console.log("\nOpen the URL above in your browser to confirm it's live.");
} catch (err) {
  console.error("\n❌  Deployment failed:", err.message);
  process.exit(1);
}
