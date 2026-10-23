"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** Skip first paint until the client has mounted (avoids hydration mismatches). */
export function AfterMount({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(emptySubscribe, () => true, () => false);
  if (!ready) return <div className="min-h-screen" suppressHydrationWarning />;
  return children;
}
