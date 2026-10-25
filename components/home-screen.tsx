"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/components/api";
import { ErrorCode, useI18n } from "@/components/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  evaluateUpdate,
  fetchLatestRelease,
  installAvailableUpdate,
  isTauriDesktop,
  loadRunningAppVersion,
  type AppVersionInfo,
  type UpdateCheckResult,
} from "@/lib/app-update";

type WatchStatus = {
  watchPath: string | null;
  suggestedPath: string | null;
  lastScanAt: string | null;
  scanning: boolean;
  filesSeen: number;
  filesRead: number;
  filesUnchanged: number;
  lootAdded: number;
  problems: string[];
};

export function HomeScreen() {
  const { copy, stamp, explain } = useI18n();
  const [watch, setWatch] = useState<WatchStatus | null>(null);
  const [pathValue, setPathValue] = useState("");
  const [pathReady, setPathReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const watchBody = await api<WatchStatus>("/api/watch");
      setWatch(watchBody);
      setError(null);
      if (!pathReady) {
        setPathValue(watchBody.watchPath ?? "");
        setPathReady(true);
      }
    } catch (caught) {
      setError(explain(caught, ErrorCode.homeLoadFailed));
    }
  }, [explain, pathReady]);

  useEffect(() => {
    const first = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load();
    }, 4000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await loadRunningAppVersion();
      if (!cancelled) {
        setVersionInfo(info);
        setDesktop(isTauriDesktop());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function savePath() {
    setSaving(true);
    setError(null);
    try {
      const next = await api<WatchStatus>("/api/watch", {
        method: "PUT",
        body: JSON.stringify({ path: pathValue }),
      });
      setWatch(next);
      window.dispatchEvent(new Event("mnm:watch-path"));
    } catch (caught) {
      setError(explain(caught, ErrorCode.homeSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function checkUpdates() {
    if (!versionInfo) return;
    setUpdateBusy(true);
    setUpdateError(null);
    setUpdateResult(null);
    try {
      const release = await fetchLatestRelease(versionInfo.githubRepo);
      setUpdateResult(evaluateUpdate(versionInfo.version, release));
    } catch {
      setUpdateError(copy.home.updatesFailed);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate() {
    if (!updateResult || updateResult.status !== "available") return;
    if (!desktop) {
      window.open(updateResult.htmlUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setInstallBusy(true);
    setUpdateError(null);
    try {
      await installAvailableUpdate(updateResult.asset);
    } catch {
      setUpdateError(copy.home.updatesInstallFailed);
      setInstallBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader title={copy.shell.options} />
      <Card>
        <CardHeader>
          <CardTitle as="h3">{copy.home.folderTitle}</CardTitle>
          <CardDescription>{copy.home.folderBody}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="watch-path">{copy.home.path}</Label>
            <Input
              id="watch-path"
              value={pathValue}
              spellCheck={false}
              placeholder={copy.home.pathPlaceholder}
              className="placeholder:italic placeholder:text-muted-foreground/55"
              onChange={(event) => setPathValue(event.target.value)}
            />
          </div>
          {watch?.suggestedPath && pathValue.trim() !== watch.suggestedPath ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start gap-0 px-3 py-2.5 text-left whitespace-normal"
              aria-label={`${copy.home.useSuggestedPath}. ${copy.home.useSuggestedPathHint}: ${watch.suggestedPath}`}
              onClick={() => {
                setPathValue(watch.suggestedPath ?? "");
                document.getElementById("watch-path")?.focus();
              }}
            >
              <span className="grid min-w-0 gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-heading text-sm font-medium">{copy.home.useSuggestedPath}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {copy.home.useSuggestedPathHint}
                  </span>
                </span>
                <span className="break-all font-mono text-xs font-normal text-muted-foreground">
                  {watch.suggestedPath}
                </span>
              </span>
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saving || !pathValue.trim()} onClick={() => void savePath()}>
              {saving ? copy.home.reading : copy.home.useFolder}
            </Button>
          </div>
          {watch?.lastScanAt ? (
            <p className="text-sm text-muted-foreground">
              {copy.home.lastScan(stamp(watch.lastScanAt), watch.filesSeen, watch.lootAdded, watch.scanning)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.home.noScan}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3">{copy.home.updatesTitle}</CardTitle>
          <CardDescription>{copy.home.updatesBody}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {versionInfo ? (
            <p className="text-sm font-medium">{copy.home.updatesInstalled(versionInfo.version)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.home.loading}</p>
          )}
          {!desktop ? <p className="text-sm text-muted-foreground">{copy.home.updatesDesktopOnly}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!versionInfo || updateBusy || installBusy}
              onClick={() => void checkUpdates()}
            >
              {updateBusy ? copy.home.updatesChecking : copy.home.updatesCheck}
            </Button>
            {versionInfo ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(versionInfo.releasesUrl, "_blank", "noopener,noreferrer")}
              >
                {copy.home.updatesOpenRelease}
              </Button>
            ) : null}
          </div>
          {updateResult?.status === "upToDate" ? (
            <p className="text-sm text-muted-foreground">{copy.home.updatesUpToDate(updateResult.latest)}</p>
          ) : null}
          {updateResult?.status === "noAsset" ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">{copy.home.updatesNoAsset}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(updateResult.htmlUrl, "_blank", "noopener,noreferrer")}
              >
                {copy.home.updatesOpenRelease}
              </Button>
            </div>
          ) : null}
          {updateResult?.status === "available" ? (
            <div className="grid gap-2 rounded-sm border border-[#6e5338]/40 bg-[#efe6d6]/40 p-3">
              <p className="text-sm font-medium">
                {copy.home.updatesAvailable(updateResult.latest, updateResult.current)}
              </p>
              {updateResult.notes ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                  {updateResult.notes}
                </pre>
              ) : null}
              <p className="text-xs text-muted-foreground">{copy.home.updatesSmartScreen}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={installBusy} onClick={() => void installUpdate()}>
                  {installBusy ? copy.home.updatesDownloading : copy.home.updatesDownload}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.open(updateResult.htmlUrl, "_blank", "noopener,noreferrer")}
                >
                  {copy.home.updatesOpenRelease}
                </Button>
              </div>
            </div>
          ) : null}
          {updateError ? <p className="text-sm text-destructive">{updateError}</p> : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.home.unreadable}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {copy.common.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
