// src/utils/semver.ts

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
  buildmetadata?: string;
}

/**
 * Parses a version string into a structured SemVer object according to SemVer 2.0.0 spec.
 * Returns null if the string is not a valid semver version.
 */
export function parseSemVer(version: string): SemVer | null {
  // Regex pattern matching standard SemVer 2.0.0
  const match = version.trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
  );
  if (!match) return null;

  const prereleaseStr = match[4];
  const prerelease = prereleaseStr ? prereleaseStr.split(".") : undefined;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease,
    buildmetadata: match[5] || undefined,
  };
}

/**
 * Compares two semver strings.
 * Returns:
 *   -1 if v1 < v2
 *    0 if v1 == v2
 *    1 if v1 > v2
 *
 * Precedence rules follow SemVer 2.0.0. Build metadata is ignored.
 */
export function compareVersions(v1: string, v2: string): number {
  const sv1 = parseSemVer(v1);
  const sv2 = parseSemVer(v2);

  if (!sv1 && !sv2) return 0;
  if (!sv1) return -1;
  if (!sv2) return 1;

  // 1. Compare major, minor, patch numerically
  if (sv1.major !== sv2.major) return sv1.major > sv2.major ? 1 : -1;
  if (sv1.minor !== sv2.minor) return sv1.minor > sv2.minor ? 1 : -1;
  if (sv1.patch !== sv2.patch) return sv1.patch > sv2.patch ? 1 : -1;

  // 2. Compare pre-release presence: normal release has higher precedence than pre-release
  if (!sv1.prerelease && sv2.prerelease) return 1;
  if (sv1.prerelease && !sv2.prerelease) return -1;
  if (!sv1.prerelease && !sv2.prerelease) return 0; // Both are normal releases

  // 3. Both are pre-releases, compare segments
  const pr1 = sv1.prerelease!;
  const pr2 = sv2.prerelease!;
  const len = Math.max(pr1.length, pr2.length);

  for (let i = 0; i < len; i++) {
    // If we run out of identifiers on one side: the version with more identifiers has higher precedence
    if (pr1[i] === undefined && pr2[i] !== undefined) return -1;
    if (pr1[i] !== undefined && pr2[i] === undefined) return 1;

    const part1 = pr1[i];
    const part2 = pr2[i];

    const isNum1 = /^\d+$/.test(part1);
    const isNum2 = /^\d+$/.test(part2);

    if (isNum1 && isNum2) {
      // Numeric identifiers have lower precedence than non-numeric, but between numeric they are compared numerically
      const num1 = parseInt(part1, 10);
      const num2 = parseInt(part2, 10);
      if (num1 !== num2) return num1 > num2 ? 1 : -1;
    } else if (!isNum1 && !isNum2) {
      // Both are non-numeric, compare alphabetically in ASCII
      if (part1 !== part2) return part1.localeCompare(part2) > 0 ? 1 : -1;
    } else {
      // Numeric vs non-numeric: Numeric identifiers always have lower precedence than non-numeric
      return isNum1 ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Checks if a version is a pre-release version.
 */
export function isPrerelease(version: string): boolean {
  const parsed = parseSemVer(version);
  return parsed ? parsed.prerelease !== undefined : false;
}
