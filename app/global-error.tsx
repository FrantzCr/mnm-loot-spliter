"use client";

import { useEffect, useState } from "react";

import { reloadForChunkError, shouldReloadForChunkError } from "@/lib/chunk-recovery";

/** Root-layout failures (incl. stale chunks in the packaged app). No app CSS here by design. */
export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  const [reloading] = useState(() => shouldReloadForChunkError(error));
  useEffect(() => {
    if (reloading) reloadForChunkError();
  }, [reloading]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "Georgia, serif", padding: 24, background: "#1b1712", color: "#efe6d4" }}>
        <title>MnM Loot Splitter</title>
        {reloading ? null : (
          <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Something went wrong</h2>
            <p style={{ margin: 0, opacity: 0.8 }}>The page failed to load. Reloading usually fixes it.</p>
            <div>
              <button type="button" onClick={() => window.location.reload()} style={{ padding: "6px 14px", cursor: "pointer" }}>
                Reload
              </button>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
