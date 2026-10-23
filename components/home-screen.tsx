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
