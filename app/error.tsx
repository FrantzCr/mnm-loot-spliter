"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/components/locale";
import { Button } from "@/components/ui/button";
import { reloadForChunkError, shouldReloadForChunkError } from "@/lib/chunk-recovery";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const { copy } = useI18n();
  const [reloading] = useState(() => shouldReloadForChunkError(error));
  useEffect(() => {
    if (reloading) reloadForChunkError();
  }, [reloading]);
  useEffect(() => {
    const next = `${copy.status.errorTitle} — ${copy.shell.title}`;
    const apply = () => {
      if (document.title !== next) document.title = next;
    };
    apply();
    const timer = window.setInterval(apply, 200);
    const stop = window.setTimeout(() => window.clearInterval(timer), 2000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [copy.status.errorTitle, copy.shell.title]);
  if (reloading) return null;
  return (
    <div className="grid max-w-lg gap-3">
      <title>{`${copy.status.errorTitle} — ${copy.shell.title}`}</title>
      <h2 className="font-heading text-2xl">{copy.status.errorTitle}</h2>
      <p className="text-sm text-muted-foreground">{copy.status.errorBody}</p>
      <div>
        <Button type="button" onClick={() => retry()}>
          {copy.common.retry}
        </Button>
      </div>
    </div>
  );
}
