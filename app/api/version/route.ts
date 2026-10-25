import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GITHUB_REPO = "FrantzCr/mnm-loot-spliter";

export async function GET() {
  const pkgPath = join(process.cwd(), "package.json");
  const raw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { version?: string; name?: string };
  return Response.json({
    name: pkg.name ?? "mnm-loot-spliter",
    version: pkg.version ?? "0.0.0",
    githubRepo: GITHUB_REPO,
    releasesUrl: `https://github.com/${GITHUB_REPO}/releases`,
  });
}
