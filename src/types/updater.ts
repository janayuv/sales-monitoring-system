// src/types/updater.ts

export type UpdateState =
  | "Idle"
  | "Checking"
  | "NoUpdate"
  | "UpdateAvailable"
  | "Downloading"
  | "Downloaded"
  | "Installing"
  | "Installed"
  | "RestartRequired"
  | "Cancelled"
  | "Failed";

export type UpdateError =
  | "Offline"
  | "Timeout"
  | "ManifestInvalid"
  | "SignatureInvalid"
  | "ChecksumMismatch"
  | "DownloadFailed"
  | "InstallFailed"
  | "RestartFailed"
  | "Cancelled"
  | "Unknown";

export const UpdateErrorCatalog: Record<UpdateError, string> = {
  Offline: "No internet connection. Please check your network and try again.",
  Timeout: "The update server connection timed out.",
  ManifestInvalid: "The update manifest (latest.json) is invalid or malformed.",
  SignatureInvalid: "The downloaded update failed cryptographic signature verification.",
  ChecksumMismatch: "The downloaded update file integrity check failed (checksum mismatch).",
  DownloadFailed: "Failed to download the update package.",
  InstallFailed: "Failed to install the downloaded update.",
  RestartFailed: "The update was installed successfully, but relaunching the application failed.",
  Cancelled: "The update process was cancelled.",
  Unknown: "An unexpected error occurred during the update process.",
};

export type UpdateChannel = "Production" | "Preview" | "Internal";

export type UpdateResult<T> =
  | { success: true; data: T }
  | { success: false; error: UpdateError; message: string };

export interface BuildMetadata {
  app_version: string;
  build_date: string;
  build_time: string;
  git_hash: string;
  git_branch: string;
  rust_version: string;
  target: string;
  profile: string;
  build_number: string;
}

export interface UpdateLog {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  event: string;
  version?: string;
  details?: string;
}

export interface UpdateMetrics {
  check_count: number;
  download_success: number;
  download_failure: number;
  install_success: number;
  install_failure: number;
}

export interface UpdateManifest {
  manifestVersion: number;
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<
    string,
    {
      signature: string;
      url: string;
      size?: number;
      checksum?: string;
    }
  >;
}
