// src/services/updater/IUpdateProvider.ts
import { UpdateChannel, UpdateManifest, UpdateResult } from "../../types/updater";

export interface IUpdateProvider {
  /**
   * Fetches the latest update manifest file for the given release channel.
   */
  fetchManifest(channel: UpdateChannel): Promise<UpdateResult<UpdateManifest>>;

  /**
   * Retrieves the release notes details for a specific version.
   */
  fetchReleaseNotes(version: string): Promise<string>;
}
