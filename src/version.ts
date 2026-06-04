import { readFileSync } from "node:fs";

// `__SDK_VERSION__` is replaced at build time by tsup (see tsup.config.ts),
// sourced from package.json so the User-Agent version never drifts from the
// published package version. When running unbundled (e.g. vitest), the
// identifier is undefined and we fall back to reading package.json directly.
declare const __SDK_VERSION__: string | undefined;

function readVersionFromPackageJson(): string {
  try {
    // Resolved relative to this module: src/version.ts -> ../package.json in
    // dev/test, dist/index.* -> ../package.json once published.
    const url = new URL("../package.json", import.meta.url);
    const raw = readFileSync(url, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SDK_VERSION: string =
  typeof __SDK_VERSION__ === "string"
    ? __SDK_VERSION__
    : readVersionFromPackageJson();

export const SDK_USER_AGENT = `prompt-helm-sdk-node/${SDK_VERSION}`;
