import type { SystemUpdateStatus, TriggerUpdateResult } from "@/types/admin-dashboard";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRANCH = "main";
const DEFAULT_REPO = "Murlidhar08/next-auth-template";

/**
 * Normalizes any GitHub repo string (full URL, git@ URL, or owner/repo) to 'owner/repo'.
 */
export function normalizeRepo(rawInput: string): string {
  const trimmed = rawInput.trim().replace(/^['"]|['"]$/g, "");
  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  const simpleMatch = trimmed.match(/^([^/]+)\/([^/.]+)$/);
  if (simpleMatch) {
    return `${simpleMatch[1]}/${simpleMatch[2]}`;
  }
  return trimmed.replace(/\.git$/, "");
}

/**
 * Parses a semver string into [major, minor, patch] numbers.
 */
export function parseSemver(v: string): [number, number, number] {
  if (!v) return [0, 0, 0];
  const clean = v.replace(/^v/, "").trim().split("-")[0].split("+")[0];
  const parts = clean.split(".").map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compares two semver strings.
 * Returns: 1 if latest > current, -1 if latest < current, 0 if equal.
 */
export function compareSemver(current: string, latest: string): number {
  const [cMajor, cMinor, cPatch] = parseSemver(current);
  const [lMajor, lMinor, lPatch] = parseSemver(latest);

  if (lMajor !== cMajor) return lMajor > cMajor ? 1 : -1;
  if (lMinor !== cMinor) return lMinor > cMinor ? 1 : -1;
  if (lPatch !== cPatch) return lPatch > cPatch ? 1 : -1;
  return 0;
}

/**
 * Reads local package.json version.
 */
export function getLocalPackageVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      return pkg.version || "0.0.1";
    }
  } catch {
    // fallback
  }
  return "0.0.1";
}

interface VersionCandidate {
  version: string;
  source: string;
  publishedAt?: string;
}

/**
 * Checks GitHub for the latest version across Releases, Tags, Version Branches,
 * and remote package.json.
 * If fetching fails, captures and surfaces the exact error rather than predicting
 * or defaulting to the current version.
 */
export async function checkForUpdates(): Promise<SystemUpdateStatus> {
  const repo = normalizeRepo(process.env.GITHUB_REPOSITORY || DEFAULT_REPO);
  const currentVersion = getLocalPackageVersion();
  const hasWebhook = Boolean(process.env.UPDATE_WEBHOOK_URL?.trim().length);

  const headers: Record<string, string> = {
    "User-Agent": "Next-Template-AutoUpdate/1.0",
    Accept: "application/vnd.github.v3+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const candidates: VersionCandidate[] = [];
  const errors: string[] = [];

  // 1. Check GitHub Latest Release
  try {
    const releaseRes = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { headers, cache: "no-store" }
    );

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      if (release.tag_name) {
        candidates.push({
          version: release.tag_name.replace(/^v/, "").trim(),
          source: "GitHub Release",
          publishedAt: release.published_at,
        });
      }
    } else if (releaseRes.status === 403) {
      const body = await releaseRes.json().catch(() => null);
      errors.push(
        body?.message?.includes("rate limit")
          ? "GitHub API rate limit exceeded (403)"
          : `GitHub API forbidden (403): ${body?.message || "Access denied"}`
      );
    } else if (releaseRes.status !== 404) {
      errors.push(`GitHub Releases returned status ${releaseRes.status}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Failed to fetch GitHub releases");
  }

  // 2. Check GitHub Tags (in case tags are created without formal Releases)
  try {
    const tagsRes = await fetch(
      `https://api.github.com/repos/${repo}/tags?per_page=20`,
      { headers, cache: "no-store" }
    );

    if (tagsRes.ok) {
      const tags = (await tagsRes.json()) as Array<{ name: string }>;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          const clean = tag.name?.replace(/^v/, "").trim();
          if (clean && /^\d+(\.\d+)+/.test(clean)) {
            candidates.push({
              version: clean,
              source: `Git Tag (${tag.name})`,
            });
          }
        }
      }
    } else if (tagsRes.status === 403 && !errors.some((e) => e.includes("403"))) {
      errors.push("GitHub API rate limit exceeded (403)");
    }
  } catch {
    // Ignore secondary tag check errors if other checks succeed
  }

  // 3. Check GitHub Branches (version branches such as v0.0.2 created by CI/CD)
  try {
    const branchesRes = await fetch(
      `https://api.github.com/repos/${repo}/branches?per_page=30`,
      { headers, cache: "no-store" }
    );

    if (branchesRes.ok) {
      const branches = (await branchesRes.json()) as Array<{ name: string }>;
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          const match = branch.name?.match(/^v?(\d+\.\d+(?:\.\d+)?)/);
          if (match && match[1]) {
            candidates.push({
              version: match[1],
              source: `Version Branch (${branch.name})`,
            });
          }
        }
      }
    }
  } catch {
    // Ignore secondary branch check errors
  }

  // 4. Check remote package.json on target branch (main)
  try {
    const rawPkgRes = await fetch(
      `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(BRANCH)}/package.json?t=${Date.now()}`,
      {
        headers: { "User-Agent": "Next-Template-AutoUpdate/1.0" },
        cache: "no-store",
      }
    );

    if (rawPkgRes.ok) {
      const remotePkg = await rawPkgRes.json();
      if (remotePkg.version) {
        candidates.push({
          version: remotePkg.version.replace(/^v/, "").trim(),
          source: `${BRANCH} branch package.json`,
        });
      }
    } else if (rawPkgRes.status !== 404) {
      errors.push(`Remote package.json returned status ${rawPkgRes.status}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Failed to fetch remote package.json");
  }

  // Determine latest version from collected candidates
  if (candidates.length > 0) {
    // Sort descending by semver to find highest version
    candidates.sort((a, b) => compareSemver(b.version, a.version));
    const highest = candidates[0];

    const hasUpdate = compareSemver(currentVersion, highest.version) > 0;

    return {
      currentVersion,
      latestVersion: highest.version,
      hasUpdate,
      publishedAt: highest.publishedAt,
      checkedAt: new Date().toISOString(),
      hasWebhook,
      source: highest.source,
    };
  }

  // No candidates could be fetched - surface the exact error rather than predicting/defaulting
  const combinedError = errors.length > 0
    ? errors[0]
    : `Unable to retrieve remote version from ${repo}. Please verify repository access.`;

  return {
    currentVersion,
    latestVersion: "",
    hasUpdate: false,
    checkedAt: new Date().toISOString(),
    hasWebhook,
    error: combinedError,
  };
}

/**
 * Triggers the update webhook URL to deploy or update the application.
 */
export async function triggerUpdateWebhook(): Promise<TriggerUpdateResult> {
  const webhookUrl = process.env.UPDATE_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error("Update webhook URL is not configured. Please set UPDATE_WEBHOOK_URL in your environment variables.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error("Configured UPDATE_WEBHOOK_URL is not a valid URL. Please check your environment variables.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    let response = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Update webhook returned error status ${response.status}${errorText ? `: ${errorText.slice(0, 100)}` : ""}`);
    }

    return {
      success: true,
      message: "Application update triggered successfully. Deployment started.",
      statusCode: response.status,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Update webhook request timed out after 15 seconds.");
    }
    throw error;
  }
}
