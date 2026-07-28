# Software Release Process

This document outlines the step-by-step release process for compiling, signing, and publishing desktop builds to the public GitHub Releases repository.

## GitHub Repositories Setup

The application separates concerns by deploying code and releases into two separate repositories:

1. **Private Repository (`sales-monitoring-system-private`)**:
   - Contains all private source code, database schemas, and algorithms.
   - Houses the CI test pipeline and Release build workflows.
   - Holds repository secrets (Code signing keys, GitHub access tokens).

2. **Public Repository (`sales-monitoring-system`)**:
   - Contains NO source code.
   - Holds the compiled release binaries (`.msi`, Portable `.zip`) and update manifests (`latest.json`, `preview-latest.json`, `internal-latest.json`).
   - Acts as the serverless host for in-app software updates.

## GitHub Actions Secret Configuration

Before running the release pipeline, configure the following secrets under **Settings > Secrets and variables > Actions** in the private repository:

* `RELEASE_REPO_TOKEN`: A Personal Access Token (PAT) with `repo` write scopes for the public release repository. This allows the compiler to publish releases.
* `TAURI_SIGNING_PRIVATE_KEY`: The Ed25519 private key string used to sign updater packages.
* `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: The password configured when generating the Ed25519 signing key.

## Creating a Release Tag

Every release is triggered by pushing a version tag matching the format `v*.*.*`. The tag name determines which release channel the update is deployed to:

| Tag Format | Target Channel | Manifest Generated | Target Users |
| :--- | :--- | :--- | :--- |
| `v1.2.5` | **Production** | `latest.json` | All general customers |
| `v1.3.0-preview.1` | **Preview** | `preview-latest.json` | Beta testing group |
| `v1.3.0-internal.3` | **Internal** | `internal-latest.json` | Internal developers & QA |

### Commands to Push a Tag
```bash
# 1. Update the version in package.json and src-tauri/tauri.conf.json to 1.2.5
# 2. Commit the version bump changes
git commit -am "chore: bump version to 1.2.5"

# 3. Create a git tag
git tag v1.2.5

# 4. Push the tag to GitHub
git push origin v1.2.5
```

## Release Pipeline Execution

Once the tag is pushed:
1. GitHub Actions spins up a Windows runner.
2. The code is compiled in release mode (`npm run tauri build`).
3. The build runner signs the installer bundles using the `TAURI_SIGNING_PRIVATE_KEY`.
4. The workflow runs `Parse Signatures & Compile Update Manifest` bash steps to extract the Ed25519 signature from `*.msi.zip.sig`.
5. It compiles the appropriate channel manifest (e.g. `latest.json` for Production).
6. Assets are uploaded as a **Draft** release in the public repository.

## Verification & Promotion Steps (Mandatory QA Sign-Off)

To avoid publishing broken versions, releases are initially uploaded in **Draft** mode. Follow these steps to verify and publish:

1. **Download Draft Installer**: Navigate to the public Releases page and download the draft `.msi` bundle.
2. **Install and Run**: Run the installer on a clean target machine (Windows 10/11) to check for registry or initialization crashes.
3. **Verify Settings Preservation**: Ensure existing SQLite profiles and matching histories are preserved without format corruption.
4. **Smoke Test the Updater**: Run the previous version, switch channels, manually check for updates, download, and verify successful relaunch.
5. **Publish**: In the GitHub Releases page, select the draft release, click **Edit**, write the release summary log notes, and click **Publish Release** to promote it to general users.
