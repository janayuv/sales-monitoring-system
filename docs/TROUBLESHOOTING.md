# Updater Troubleshooting Guide

This guide describes how to diagnose and resolve software update issues.

## Diagnostic Tools

1. **Internal Log File (`update.log`)**:
   - Location: Located in the local AppData directory (`%APPDATA%/tauri-app/update.log` on Windows).
   - Rotation: Automatically rotates. If the file size exceeds 5MB, it shifts to `update.log.1` (retaining up to 5 historical log backups).
   - Format: Structured JSON lines containing level, timestamp, event, version, and details.

2. **Diagnostics Panel**:
   - Access: Settings Tab > Show Diagnostics details.
   - Purpose: View live telemetry counters, manifest endpoints, connection status, and log logs in real-time.

## Common Error Classifications & Resolution

### 1. OFFLINE ("No internet connection.")
* **Cause**: User's device is disconnected from the network, or raw.githubusercontent.com is blocked by local firewalls.
* **Resolution**: The updater will gracefully ignore checking if offline. Check network status, bypass proxy settings, or add an exception to corporate firewalls.

### 2. TIMEOUT ("Server connection timed out.")
* **Cause**: Update check was blocked, or network latency is high.
* **Resolution**: The updater performs an exponential backoff (retrying 3 times, waiting up to 6 seconds). Verify DNS server parameters.

### 3. MANIFEST_INVALID ("Update server returned corrupt manifest.")
* **Cause**: The `latest.json` file in GitHub Releases is malformed or has an incompatible schema version (`manifestVersion > 1`).
* **Resolution**: Re-compile and publish a valid manifest file. You can download the manual installer directly from the GitHub releases page using the link in the error dialog.

### 4. SIGNATURE_INVALID ("Installer signature verification failed.")
* **Cause**: The binary package has been tampered with, or the public key configured in `tauri.conf.json` does not match the private key used to sign the build.
* **Resolution**:
  1. Regenerate keys using `npm run tauri signer generate`.
  2. Embed the public key in `tauri.conf.json`'s `"pubkey"` field.
  3. Update `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets and push a new tag.

### 5. Update Loop / Restart Loop
* **Cause**: Relaunch is requested, but Windows keeps launching the old version.
* **Resolution**:
  1. Trigger the **Repair Updater** system recovery hook from the Diagnostics Panel.
  2. Run a clean install by downloading the latest installer manually.

## Manual System Repair / Recovery

If the updater is in an inconsistent state or you want to re-run skipped updates:
1. Navigate to **Company Settings > Show Diagnostics details**.
2. Click the **Repair Updater** button.
3. This action runs the internal `performRecovery()` handler which:
   - Purges the `updater_skipped_version` database configuration.
   - Clears active download speed, ETA, and progress tracks.
   - Forces the updater lifecycle state machine back to `Idle`.
4. After repair, perform a manual **Check Now** verification.
