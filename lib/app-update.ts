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

const DISMISS_PREFIX = "mnm:update-dismissed:";
const LAST_CHECK_KEY = "mnm:update-last-check";

/** Skip auto-banner for this latest version until a newer tag appears. */
export function isUpdateDismissed(latestVersion: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${DISMISS_PREFIX}${latestVersion}`) === "1";
  } catch {
    return false;
  }
}

export function dismissUpdate(latestVersion: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DISMISS_PREFIX}${latestVersion}`, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function markUpdateChecked(now = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    /* ignore */
  }
}

/** True if we should hit GitHub again (startup, or last check older than `maxAgeMs`). */
export function shouldAutoCheckUpdates(maxAgeMs = 6 * 60 * 60 * 1000): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return true;
    const then = Number(raw);
    if (!Number.isFinite(then)) return true;
    return Date.now() - then >= maxAgeMs;
  } catch {
    return true;
  }
}

export async function resolveInstalledVersion(apiVersion: string): Promise<string> {
  if (!isTauriDesktop()) return apiVersion;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return apiVersion;
  }
}

/** Best-effort version for the running UI (Tauri exe → API → static JSON). */
export async function loadRunningAppVersion(): Promise<AppVersionInfo | null> {
  const fallbacks: Array<() => Promise<AppVersionInfo | null>> = [
    async () => {
      if (!isTauriDesktop()) return null;
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        return {
          name: "mnm-loot-spliter",
          version,
          githubRepo: "FrantzCr/mnm-loot-spliter",
          releasesUrl: "https://github.com/FrantzCr/mnm-loot-spliter/releases",
        };
      } catch {
        return null;
      }
    },
    async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as AppVersionInfo;
      } catch {
        return null;
      }
    },
    async () => {
      try {
        const response = await fetch("/app-version.json", { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as AppVersionInfo;
      } catch {
        return null;
      }
    },
  ];

  for (const load of fallbacks) {
    const info = await load();
    if (info?.version) return info;
  }
  return null;
}

export async function installAvailableUpdate(asset: GithubReleaseAsset): Promise<void> {
  if (!isTauriDesktop()) {
    throw new Error("Desktop app required");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("install_update", {
    url: asset.browser_download_url,
    fileName: asset.name,
  });
}
