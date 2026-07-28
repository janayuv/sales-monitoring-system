// src/config/updater.ts
import { UpdateChannel } from "../types/updater";

export interface UpdaterConfig {
  defaultChannel: UpdateChannel;
  retry: {
    count: number;
    delayMs: number;
    backoffMultiplier: number;
  };
  manifestVersion: number;
  // Caching release notes expiry in milliseconds (24 hours)
  releaseNotesCacheExpiryMs: number;
}

// Fallback configuration if tauri.conf.json cannot be read or endpoints are missing
export const DEFAULT_UPDATER_CONFIG: UpdaterConfig = {
  defaultChannel: "Production",
  retry: {
    count: 3,
    delayMs: 1500,
    backoffMultiplier: 2,
  },
  manifestVersion: 1,
  releaseNotesCacheExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Returns the updater endpoint URL dynamically based on the channel and tauri.conf.json.
 * Uses the configured URL from tauri.conf.json as the base.
 */
export function getEndpointForChannel(configuredUrl: string, channel: UpdateChannel): string {
  // If the URL is empty or does not end with latest.json, return it as is
  if (!configuredUrl || !configuredUrl.endsWith("latest.json")) {
    return configuredUrl;
  }

  const baseUrl = configuredUrl.substring(0, configuredUrl.lastIndexOf("/"));

  switch (channel) {
    case "Preview":
      return `${baseUrl}/preview-latest.json`;
    case "Internal":
      return `${baseUrl}/internal-latest.json`;
    case "Production":
    default:
      return configuredUrl;
  }
}
