// src/services/updater/GitHubReleaseService.ts
import { IUpdateProvider } from "./IUpdateProvider";
import { UpdateChannel, UpdateManifest, UpdateResult } from "../../types/updater";
import { getEndpointForChannel, DEFAULT_UPDATER_CONFIG } from "../../config/updater";

const CACHE_PREFIX = "release_notes_";

export class GitHubReleaseService implements IUpdateProvider {
  private repoOwner: string;
  private repoName: string;

  constructor(repoOwner = "janayuv", repoName = "sales-monitoring-system") {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Fetches the latest update manifest from the configured channel endpoint.
   */
  async fetchManifest(channel: UpdateChannel): Promise<UpdateResult<UpdateManifest>> {
    try {
      // Build endpoints based on the channels
      const configuredBase = `https://github.com/${this.repoOwner}/${this.repoName}/releases/latest/download/latest.json`;
      const url = getEndpointForChannel(configuredBase, channel);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let response: Response;
      try {
        response = await fetch(url, { cache: "no-cache", signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            error: "ManifestInvalid",
            message: `Update manifest not found (HTTP 404). Ensure release assets are published and repository visibility allows downloads.`,
          };
        }
        if (response.status === 403 || response.status === 429) {
          return {
            success: false,
            error: "Timeout",
            message: `Server rate limit reached (HTTP ${response.status}). Please try again later.`,
          };
        }
        return {
          success: false,
          error: "ManifestInvalid",
          message: `Failed to fetch update manifest: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      
      // Simple validation of manifest format
      if (!data.version || !data.platforms) {
        return {
          success: false,
          error: "ManifestInvalid",
          message: "The update manifest is missing required fields (version or platforms).",
        };
      }

      // Check manifest version
      const manifestVer = data.manifestVersion !== undefined ? data.manifestVersion : 1;
      if (manifestVer > DEFAULT_UPDATER_CONFIG.manifestVersion) {
        return {
          success: false,
          error: "ManifestInvalid",
          message: `Incompatible manifest version: expected <= ${DEFAULT_UPDATER_CONFIG.manifestVersion}, got ${manifestVer}`,
        };
      }

      return { success: true, data: data as UpdateManifest };
    } catch (e) {
      const isOffline = !navigator.onLine;
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      return {
        success: false,
        error: isOffline ? "Offline" : "Timeout",
        message: isOffline
          ? "Network is offline. Unable to contact update server."
          : isAbort
          ? "Server connection timed out while checking for updates."
          : e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Fetches the release notes from the GitHub API and caches them.
   */
  async fetchReleaseNotes(version: string): Promise<string> {
    const cacheKey = `${CACHE_PREFIX}${version}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        const item = JSON.parse(cached);
        if (item && item.body) {
          return item.body;
        }
      } catch {
        // Clear corrupt cache
        localStorage.removeItem(cacheKey);
      }
    }

    // Cache missed or expired, fetch from GitHub API
    try {
      // Tag names are formatted as v1.0.0 or similar
      const tag = version.startsWith("v") ? version : `v${version}`;
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/tags/${tag}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const releaseData = await res.json();
      const body = releaseData.body || `Release ${version} published successfully.`;

      // Save to cache
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          body,
          timestamp: Date.now(),
        })
      );

      return body;
    } catch (e) {
      console.warn(`Failed to fetch release notes from GitHub API for tag ${version}:`, e);
      return `### Version ${version}\n\n- No detailed release notes available offline.`;
    }
  }
}
