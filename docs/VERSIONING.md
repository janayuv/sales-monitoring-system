# Versioning & Build Numbering Strategy

This document details the versioning format and compile-time build constants generation used in the Sales Monitoring System.

## Semantic Versioning (SemVer)

The application adheres to [SemVer 2.0.0](https://semver.org/):
- **MAJOR** version for incompatible database schema updates or core architecture redesigns.
- **MINOR** version for backward-compatible features (e.g., new matching registers, exports, or tools).
- **PATCH** version for backward-compatible bug fixes and performance refinements.

For non-production channels, pre-release identifiers are appended:
- `1.2.0-preview.1`
- `1.2.0-internal.4`

The frontend parser (`src/utils/semver.ts`) strictly parses and orders these versions:
1. Compares major, minor, patch fields numerically.
2. Prereleases are sorted alphabetically (e.g. `-preview.1` < `-preview.2`).
3. Stable versions are always treated as newer than any pre-release versions (e.g. `1.2.0-preview.2` < `1.2.0`).

## Compile-Time Build Constants

To ensure zero git commands run at runtime (which can fail on users' machines without Git installed), compile-time constants are baked directly into the Rust executable during the cargo compilation step using `src-tauri/build.rs`.

The build script queries the local build environment and writes `build_constants.rs` containing:

* `APP_VERSION`: Evaluated from `CARGO_PKG_VERSION` (sourced from `Cargo.toml`).
* `BUILD_NUMBER`: Sourced from the `GITHUB_RUN_NUMBER` environment variable in CI (guaranteeing incrementing uniqueness across runs). Falls back to a local unix timestamp if built on a local developer workstation.
* `BUILD_DATE` / `BUILD_TIME`: Sourced from UTC build environment timestamps.
* `GIT_HASH`: Sourced from git commit object reference (`git rev-parse HEAD`).
* `GIT_BRANCH`: Sourced from local branch identifier (`git rev-parse --abbrev-ref HEAD`).
* `RUST_VERSION`: Sourced from `rustc --version`.
* `TARGET`: Sourced from compilation target (e.g., `x86_64-pc-windows-msvc`).
* `PROFILE`: Sourced from compilation profile (e.g., `release` or `debug`).

These are queried from the frontend via the `get_build_constants` command and rendered in the About Dialog.
