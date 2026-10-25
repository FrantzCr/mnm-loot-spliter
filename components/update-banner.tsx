"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/components/api";
import { useI18n } from "@/components/locale";
import { Button } from "@/components/ui/button";
import {
  dismissUpdate,
  evaluateUpdate,
  fetchLatestRelease,
  installAvailableUpdate,
  isTauriDesktop,
  isUpdateDismissed,
  markUpdateChecked,
  resolveInstalledVersion,
  shouldAutoCheckUpdates,
  type AppVersionInfo,
  type UpdateCheckResult,
} from "@/lib/app-update";
import { cn } from "cn";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a4503]";

/**
 * Desktop-only: quiet GitHub check after launch, banner when a newer setup exists.
 * Dismiss remembers the offered version so it does not nag until the next release.
 */
export function UpdateBanner() {
  const { copy } = useI18n();
  const [offer, setOffer] = useState<Extract<UpdateCheckResult, { status: "available" }> | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async (force: boolean) => {
    if (!isTauriDesktop()) return;
    if (!force && !shouldAutoCheckUpdates()) return;
    try {
      const info = await api<AppVersionInfo>("/api/version");
      const current = await resolveInstalledVersion(info.version);
      const release = await fetchLatestRelease(info.githubRepo);
      markUpdateChecked();
      const result = evaluateUpdate(current, release);
      if (result.status !== "available") {
        setOffer(null);
        return;
      }
      if (isUpdateDismissed(result.latest)) {
        setOffer(null);
        return;
      }
      setOffer(result);
      setError(null);
    } catch {
      /* silent on auto-check — Options still has a manual button */
    }
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    const timer = window.setTimeout(() => {
      void runCheck(false);
    }, 2500);
    const onFocus = () => {
      void runCheck(false);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [runCheck]);

  async function onInstall() {
    if (!offer) return;
    setInstalling(true);
    setError(null);
    try {
      await installAvailableUpdate(offer.asset);
    } catch {
      setError(copy.home.updatesInstallFailed);
      setInstalling(false);
    }
  }

  function onDismiss() {
    if (!offer) return;
    dismissUpdate(offer.latest);
    setOffer(null);
    setError(null);
  }

  if (!offer) return null;

  return (
    <div className="border-b border-[#6e5338]/50 bg-[#efe6d6]">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="grid min-w-0 gap-0.5">
          <p className="font-body text-sm font-medium text-foreground">
            {copy.home.updatesAvailable(offer.latest, offer.current)}
          </p>
          <p className="text-xs text-muted-foreground">{copy.home.updatesSmartScreen}</p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={installing} onClick={() => void onInstall()}>
            {installing ? copy.home.updatesDownloading : copy.home.updatesDownload}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(focusRing)}
            disabled={installing}
            onClick={onDismiss}
          >
            {copy.home.updatesLater}
          </Button>
        </div>
      </div>
    </div>
  );
}
