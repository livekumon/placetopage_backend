const VERCEL_API = "https://api.vercel.com";

/**
 * Slugify a business name into a Vercel-safe project name.
 * Max 52 chars (Vercel limit), prefix with "p2p-" to namespace our projects.
 */
function toProjectName(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45);
  return `p2p-${slug}`;
}

/**
 * Disable Vercel's "Deployment Protection" (SSO gate) on a project so the
 * generated site is publicly accessible without requiring a Vercel login.
 * Silently ignores failures — the site still works, just gated.
 */
async function disableDeploymentProtection(projectName, token) {
  try {
    await fetch(`${VERCEL_API}/v9/projects/${projectName}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });
  } catch (e) {
    console.warn("Could not disable deployment protection:", e.message);
  }
}

/**
 * Poll the deployment status until it reaches READY (or fails).
 * For a single static HTML file Vercel typically takes 5–20 seconds.
 *
 * Resolves when ready, throws on ERROR/CANCELED, times out gracefully
 * after maxWaitMs (so the caller still gets the URL even if slow).
 */
async function waitForReady(deploymentId, token, { maxWaitMs = 90000, pollMs = 2500 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue; // transient error — keep polling
      const data = await res.json();
      const state = data.readyState ?? data.status ?? "";
      console.log(`  Vercel deployment ${deploymentId} → ${state}`);
      if (state === "READY") return;
      if (state === "ERROR" || state === "CANCELED") {
        throw new Error(`Vercel deployment ${state.toLowerCase()}: ${data.errorMessage || ""}`);
      }
      // QUEUED / BUILDING / INITIALIZING → keep waiting
    } catch (e) {
      if (e.message.startsWith("Vercel deployment")) throw e; // re-throw real errors
      // Network hiccup — keep polling
    }
  }
  console.warn(`Deployment ${deploymentId} did not reach READY within ${maxWaitMs}ms — returning URL anyway.`);
}

/**
 * Deploy a single index.html to Vercel as a static site.
 *
 * Returns { deploymentId, url } where url is the live https:// address.
 *
 * Vercel free tier: unlimited static deployments.
 * Auth: Personal Access Token from vercel.com/account/tokens
 */
export async function deployToVercel({ name, html, token }) {
  if (!token) throw new Error("VERCEL_TOKEN is not configured.");

  const projectName = toProjectName(name);

  const body = {
    name: projectName,
    target: "production",
    projectSettings: {
      framework: null,
      buildCommand: null,
      outputDirectory: null,
      installCommand: null,
    },
    files: [
      {
        file: "index.html",
        data: Buffer.from(html, "utf-8").toString("base64"),
        encoding: "base64",
      },
    ],
  };

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Vercel deployment failed (${res.status}): ${err.error?.message || JSON.stringify(err)}`
    );
  }

  const data = await res.json();

  // Disable SSO/authentication protection so the site is publicly accessible
  await disableDeploymentProtection(projectName, token);

  // Wait until Vercel confirms the deployment is READY before returning the URL
  console.log(`Waiting for deployment ${data.id} to be ready…`);
  await waitForReady(data.id, token);

  // Prefer the production alias URL; fall back to the unique deployment URL
  const alias = data.alias?.[0];
  const deployUrl = alias
    ? `https://${alias}`
    : `https://${data.url}`;

  return {
    deploymentId: data.id,
    url: deployUrl,
    projectName,
  };
}
