"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useI18n } from "@/components/locale";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const { copy } = useI18n();
  useEffect(() => {
    const next = `${copy.status.missingTitle} — ${copy.shell.title}`;
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
  }, [copy.status.missingTitle, copy.shell.title]);
  return (
    <div className="grid max-w-lg gap-3">
      <title>{`${copy.status.missingTitle} — ${copy.shell.title}`}</title>
      <h2 className="font-heading text-2xl leading-snug">{copy.status.missingTitle}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.status.missingBody}</p>
      <div>
        <Button nativeButton={false} render={<Link href="/" />}>{copy.status.home}</Button>
      </div>
    </div>
  );
}
