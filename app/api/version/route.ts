import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GITHUB_REPO = "FrantzCr/mnm-loot-spliter";

async function readVersionPayload(): Promise<{
  name: string;
  version: string;
  githubRepo: string;
  releasesUrl: string;
}> {
  const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`;
  // Prefer the static file baked into the register/public tree (survives packaging).
  // Runtime-only paths (cwd): ignored for tracing so the standalone build does not pull in the repo.
  const root = /* turbopackIgnore: true */ process.cwd();
  for (const candidate of [
    join(root, "public", "app-version.json"),
    join(root, "app-version.json"),
    join(root, "package.json"),
  ]) {
    try {
      const raw = await readFile(/* turbopackIgnore: true */ candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.version) {
        return {
          name: parsed.name ?? "mnm-loot-spliter",
          version: parsed.version,
          githubRepo: GITHUB_REPO,
          releasesUrl,
        };
      }
    } catch {
      /* try next */
    }
  }
  return {
    name: "mnm-loot-spliter",
    version: "0.0.0",
    githubRepo: GITHUB_REPO,
    releasesUrl,
  };
}

export async function GET() {
  return Response.json(await readVersionPayload());
}
