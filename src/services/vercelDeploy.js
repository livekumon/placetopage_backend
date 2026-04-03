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
 * Resolve Vercel project id/name from a previous deployment (backfill for older
 * Site records missing vercelProjectId / vercelProjectName).
 */
export async function resolveVercelProjectFromDeployment(deploymentId, token) {
  if (!deploymentId || !token) return { projectId: null, projectName: null };
  try {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { projectId: null, projectName: null };
    const data = await res.json();
    const projectId =
      typeof data.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : null;
    const projectName =
      (typeof data.project?.name === "string" && data.project.name.trim()) ||
      (typeof data.name === "string" && data.name.trim()) ||
      null;
    return { projectId, projectName };
  } catch {
    return { projectId: null, projectName: null };
  }
}

/**
 * Deploy a single index.html to Vercel as a static site.
 *
 * When `targetProjectId` or `targetProjectName` is set from a prior publish, the
 * new deployment targets that existing project (Vercel API: `project` overrides
 * `name`) so production aliases stay on the same site instead of creating a new project.
 *
 * Returns { deploymentId, url, projectName, projectId }.
 *
 * Vercel free tier: unlimited static deployments.
 * Auth: Personal Access Token from vercel.com/account/tokens
 */
export async function deployToVercel({
  name,
  html,
  token,
  targetProjectId = null,
  targetProjectName = null,
}) {
  if (!token) throw new Error("VERCEL_TOKEN is not configured.");

  const id = targetProjectId && String(targetProjectId).trim();
  const trimmedName = targetProjectName && String(targetProjectName).trim();
  const derivedName = trimmedName || toProjectName(name);

  const body = {
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
  if (id) {
    body.project = id;
  } else {
    body.name = derivedName;
  }

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

  const projectIdOut =
    typeof data.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : id || null;
  const projectNameOut =
    (typeof data.project?.name === "string" && data.project.name.trim()) || derivedName;

  // Disable SSO/authentication protection so the site is publicly accessible
  await disableDeploymentProtection(projectNameOut, token);

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
    projectName: projectNameOut,
    projectId: projectIdOut,
  };
}

function vercelTeamQuerySuffix() {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function resolveVercelProjectId({ projectId, deploymentId, token }) {
  const trimmed = projectId && String(projectId).trim();
  if (trimmed) return trimmed;
  if (!deploymentId || !token) return null;
  const resolved = await resolveVercelProjectFromDeployment(deploymentId, token);
  return resolved.projectId && String(resolved.projectId).trim() ? resolved.projectId.trim() : null;
}

/**
 * Pause the Vercel project so production domains stop serving the deployment.
 * See: POST /v1/projects/{projectId}/pause
 */
export async function pauseVercelProjectForSite({ projectId, deploymentId, token }) {
  if (!token) return { ok: false, error: "VERCEL_TOKEN is not configured" };
  const pid = await resolveVercelProjectId({ projectId, deploymentId, token });
  if (!pid) return { ok: false, error: "No Vercel project id for this site" };

  const q = vercelTeamQuerySuffix();
  const res = await fetch(`${VERCEL_API}/v1/projects/${encodeURIComponent(pid)}/pause${q}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || res.statusText || "Pause failed";
    return { ok: false, error: msg };
  }
  return { ok: true };
}

/**
 * Unpause after restore from recycle bin so the project can serve again.
 * See: POST /v1/projects/{projectId}/unpause
 */
export async function unpauseVercelProjectForSite({ projectId, deploymentId, token }) {
  if (!token) return { ok: false, error: "VERCEL_TOKEN is not configured" };
  const pid = await resolveVercelProjectId({ projectId, deploymentId, token });
  if (!pid) return { ok: false, error: "No Vercel project id for this site" };

  const q = vercelTeamQuerySuffix();
  const res = await fetch(`${VERCEL_API}/v1/projects/${encodeURIComponent(pid)}/unpause${q}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || res.statusText || "Unpause failed";
    return { ok: false, error: msg };
  }
  return { ok: true };
}

/**
 * Add a custom domain (e.g. "biryani-blues.placetopage.com") to a Vercel project.
 *
 * Requires:
 *  1. The domain's root ("placetopage.com") must already be added to the Vercel account.
 *  2. A wildcard DNS record: CNAME *.placetopage.com → cname.vercel-dns.com
 *
 * Returns { ok: true } on success, { ok: false, error } on failure (caller decides
 * whether to fall back to the Vercel URL).
 */
export async function addCustomDomain({ projectName, domain, token }) {
  try {
    const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}/domains`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: domain }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`addCustomDomain failed (${res.status}):`, data?.error?.message ?? JSON.stringify(data));
      return { ok: false, error: data?.error?.message ?? "Domain assignment failed" };
    }
    return { ok: true, data };
  } catch (e) {
    console.warn("addCustomDomain error:", e.message);
    return { ok: false, error: e.message };
  }
}
