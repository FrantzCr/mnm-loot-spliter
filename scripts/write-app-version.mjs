/**
 * Write public/app-version.json from package.json so the UI can show the
 * running build even when /api/version is unavailable in a packaged tree.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });
const payload = {
  name: pkg.name ?? "mnm-loot-spliter",
  version: pkg.version ?? "0.0.0",
  githubRepo: "FrantzCr/mnm-loot-spliter",
  releasesUrl: "https://github.com/FrantzCr/mnm-loot-spliter/releases",
};
writeFileSync(join(outDir, "app-version.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote public/app-version.json → ${payload.version}`);
