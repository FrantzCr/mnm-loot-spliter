/**
 * Recovery for stale/missing JS chunks (packaged sidecar swapped under an open window,
 * or a half-written `.next/static`). One hard reload per path per session; a second
 * failure falls through to the normal error UI so we never loop.
 */

const KEY_PREFIX = "mnm:chunk-reload:";

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return (
    name === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message)
  );
}

function reloadKey(): string {
  return KEY_PREFIX + window.location.pathname;
}

/** True when this error is a chunk failure we have not already reloaded for on this path. */
export function shouldReloadForChunkError(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  try {
    return !window.sessionStorage.getItem(reloadKey());
  } catch {
    // Storage blocked: allow the reload; worst case the error UI shows after.
    return true;
  }
}

/** Mark this path as reloaded, then hard-reload. */
export function reloadForChunkError(): void {
  try {
    window.sessionStorage.setItem(reloadKey(), String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
}
