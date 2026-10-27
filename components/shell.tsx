"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/components/api";
import { LanguageMenu } from "@/components/language-menu";
import { useI18n } from "@/components/locale";
import { UpdateBanner } from "@/components/update-banner";
import { loadRunningAppVersion } from "@/lib/app-update";
import { cn } from "cn";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a4503]";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { copy } = useI18n();
  const [needsWatchPath, setNeedsWatchPath] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const onOptions = pathname.startsWith("/options");
  const links = [
    { href: "/group", label: copy.shell.group },
    { href: "/prices", label: copy.shell.prices },
    { href: "/options", label: copy.shell.options },
  ];
  const page =
    pathname === "/"
      ? copy.shell.recap
      : pathname.startsWith("/group")
        ? copy.shell.group
        : pathname.startsWith("/prices")
          ? copy.shell.prices
          : pathname.startsWith("/options")
            ? copy.shell.options
            : null;

  const titled = page ? `${page} — ${copy.shell.title}` : null;

  const refreshWatchPath = useCallback(async () => {
    try {
      const body = await api<{ watchPath: string | null }>("/api/watch");
      setNeedsWatchPath(!body.watchPath?.trim());
    } catch {
      /* keep last known state */
    }
  }, []);

  useEffect(() => {
    if (!titled) return;
    const apply = () => {
      if (document.title !== titled) document.title = titled;
    };
    apply();
    const timer = window.setInterval(apply, 200);
    const stop = window.setTimeout(() => window.clearInterval(timer), 2000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [titled]);

  useEffect(() => {
    // First read on the next tick (state is set after the fetch, never synchronously in the effect).
    const first = window.setTimeout(() => void refreshWatchPath(), 0);
    const onWatchPath = () => {
      void refreshWatchPath();
    };
    window.addEventListener("mnm:watch-path", onWatchPath);
    window.addEventListener("focus", onWatchPath);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("mnm:watch-path", onWatchPath);
      window.removeEventListener("focus", onWatchPath);
    };
  }, [pathname, refreshWatchPath]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await loadRunningAppVersion();
      if (!cancelled && info?.version) setAppVersion(info.version);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <div className="flex flex-1 flex-col bg-[#f3eee4]">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-[#1a140e] focus:px-3 focus:py-2 focus:text-[#f7f3ea]"
          onClick={(event) => {
            const main = document.getElementById("content");
            if (!main) return;
            event.preventDefault();
            main.focus();
          }}
        >
          {copy.shell.skip}
        </a>
        <header className="sticky top-0 z-40 border-b-2 border-[#c9b79a] bg-[#f7f3ea] shadow-[inset_0_-1px_0_rgba(255,250,240,0.55)]">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Link
              href="/"
              className={cn(
                "inline-flex items-center gap-2 font-heading text-lg leading-none text-foreground hover:text-[#7a4503]",
                focusRing,
              )}
            >
              {/* Local packaged asset — next/image adds little value here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/app-icon.png"
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 object-contain"
                aria-hidden="true"
              />
              Monsters & Memories
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <nav aria-label={copy.shell.nav} className="flex flex-wrap gap-0.5">
                {links.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-body text-sm",
                        focusRing,
                        active
                          ? "bg-foreground text-background hover:bg-foreground hover:text-background"
                          : "text-foreground hover:bg-[#efe6d6]/80 hover:text-[#7a4503]",
                      )}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
              <LanguageMenu />
            </div>
          </div>
        </header>
        <div className="border-b border-[#6e5338]/45 bg-[#8d6234] text-[#f7f3ea]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-1.5 sm:px-6">
            <h1 className="font-heading text-sm tracking-wide sm:text-[0.9375rem]">{copy.shell.title}</h1>
            {appVersion ? (
              <p
                className="shrink-0 font-mono text-xs tracking-wide text-[#f7f3ea]/85"
                title={copy.home.updatesInstalled(appVersion)}
              >
                {copy.shell.versionLabel(appVersion)}
              </p>
            ) : null}
          </div>
        </div>
        <UpdateBanner />
        {needsWatchPath ? (
          <div className="border-b border-[#6e5338]/40 bg-[#efe6d6]">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
              <p className="font-body text-sm text-foreground">
                {onOptions ? copy.home.needWatchPathHere : copy.home.needWatchPath}
              </p>
              {!onOptions ? (
                <Link
                  href="/options"
                  className={cn(
                    "rounded-md bg-foreground px-2.5 py-1 font-body text-sm text-background hover:bg-[#7a4503]",
                    focusRing,
                  )}
                >
                  {copy.home.needWatchPathCta}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        <main id="content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 outline-none sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
      <footer className="w-full border-t border-[#2a2620] bg-[#0a0a0a] text-[#c8c4bc]">
        <div className="mx-auto flex max-w-5xl flex-col gap-0.5 px-4 py-3 text-center text-xs leading-snug sm:px-6">
          <p className="text-[#e8e4dc]">{copy.shell.disclaimer}</p>
          <p className="text-[#9a958c]">{copy.shell.footer}</p>
        </div>
      </footer>
    </div>
  );
}
