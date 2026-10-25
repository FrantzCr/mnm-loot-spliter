export type AppVersionInfo = {
  name: string;
  version: string;
  githubRepo: string;
  releasesUrl: string;
};

export type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GithubRelease = {
  tag_name: string;
  name: string;
  body: string | null;
  html_url: string;
  assets: GithubReleaseAsset[];
};

export type UpdateCheckResult =
  | { status: "upToDate"; current: string; latest: string }
  | {
      status: "available";
      current: string;
      latest: string;
      tag: string;
      title: string;
      notes: string;
      htmlUrl: string;
      asset: GithubReleaseAsset;
    }
  | { status: "noAsset"; current: string; latest: string; htmlUrl: string };

export function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Positive if a > b, 0 if equal, negative if a < b. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

export function pickSetupAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | null {
  const exes = assets.filter((asset) => /\.exe$/i.test(asset.name));
  if (exes.length === 0) return null;
  const setup = exes.find((asset) => /setup|x64/i.test(asset.name));
  return setup ?? exes[0] ?? null;
}

export async function fetchLatestRelease(repo: string): Promise<GithubRelease> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mnm-loot-spliter",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GitHub releases HTTP ${response.status}`);
  }
  return (await response.json()) as GithubRelease;
}

export function evaluateUpdate(current: string, release: GithubRelease): UpdateCheckResult {
  const latest = release.tag_name.replace(/^v/i, "");
  if (compareSemver(latest, current) <= 0) {
    return { status: "upToDate", current, latest };
  }
  const asset = pickSetupAsset(release.assets);
  if (!asset) {
    return { status: "noAsset", current, latest, htmlUrl: release.html_url };
  }
  return {
    status: "available",
    current,
    latest,
    tag: release.tag_name,
    title: release.name || release.tag_name,
    notes: (release.body ?? "").trim(),
    htmlUrl: release.html_url,
    asset,
  };
}

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
