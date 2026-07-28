# Release Checklist

Follow this checklist before publishing any new update to production or staging environments.

## Pre-Release Checks
- [ ] **Verify Version Match**:
  - `package.json` version matches target tag name.
  - `src-tauri/tauri.conf.json` version matches target tag name.
- [ ] **Run Unit Tests**: Run `npm run test` or `cargo test` locally to ensure all 93 backend test cases compile and pass.
- [ ] **Verify Local Build**: Run `npm run build` to confirm there are no TypeScript compiler warnings or bundling errors.

## CI/CD Deployment Checks
- [ ] **Git Tag Push**: Create and push the Git tag (e.g. `v1.2.0` for Production, or `v1.2.0-preview.1` for Preview).
- [ ] **Monitor Actions Logs**: Check GitHub Actions in the private repository to make sure the Release builder compiles successfully.
- [ ] **Validate Generated Manifest**:
  - Inspect the generated draft release on GitHub.
  - Confirm the manifest (`latest.json` or `preview-latest.json`) has been generated and contains:
    1. Correct `version`.
    2. Valid `pub_date` timestamp.
    3. Correct download URL mapping to the `.msi.zip` asset.
    4. Valid non-empty Ed25519 signature string.

## Staged Rollout Strategy
- [ ] **Configure Staged Rollout** (optional):
  - If releasing a major version, edit `latest.json` to include `"rollout": 10` (rolling out to only 10% of users initially).
  - Gradually increase the rollout value to `25`, `50`, and finally `100` as telemetry logs show stable adoption.

## QA Smoke Testing Verification

Perform the following end-to-end smoke test sequence on a clean test machine:
- [ ] **Step 1: Install Previous Version**: Install the currently running stable build (previous version) on the machine.
- [ ] **Step 2: Load Active Workspace**: Open a demo company profile, match some invoice rows, and verify settings are saved.
- [ ] **Step 3: Trigger New Draft Release**: Run the release pipeline to output a draft release.
- [ ] **Step 4: Verify Update Detection**:
  - Run the installed previous version.
  - Navigate to updater settings, verify the channel matches, and click **Check Now**.
  - Verify that the Update Dialog modal displays the new version, date, and release notes correctly.
- [ ] **Step 5: Download & Progress verification**:
  - Click **Update Now**.
  - Verify the progress bar animates, showing correct downloaded size, speed, and ETA metrics.
- [ ] **Step 6: Install & Cryptographic check**:
  - Let the download finish. Verify the status transition to "Installing update packages...".
  - Ensure Windows User Account Control prompts for signature execution permission.
- [ ] **Step 7: Relaunch App**:
  - Click **Relaunch App**.
  - Verify the app restarts cleanly.
- [ ] **Step 8: Confirm Version Update**:
  - Open **About Application** and verify the version matches the newly installed tag.
- [ ] **Step 9: Confirm Settings Preservation**:
  - Open Settings, check if active profiles and previous matching data are completely preserved.
- [ ] **Step 10: Publish Release**: Mark the draft release as **Latest Release** on GitHub.
