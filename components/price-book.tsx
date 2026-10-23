"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/components/api";
import { CoinAmount, CoinPhrase, UnknownPrice } from "@/components/coin-amount";
import { CoinFields } from "@/components/coin-fields";
import { ErrorCode, useI18n } from "@/components/locale";
import type { ErrorCode as ErrorCodeName } from "@/lib/codes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { coinsToCopper, copperToCoins, EMPTY_COINS, type CoinParts } from "@/lib/money";
import type { PriceImportPreview } from "@/lib/price-import";
import type { MnmdbImportResult } from "@/lib/mnmdb-prices";

type CatalogRow = {
  itemKey: string;
  itemName: string;
  priceId: string | null;
  unitCopper: number | null;
  updatedAt: string | null;
  saleUnitCopper: number | null;
  saleQuantity: number | null;
  saleCopper: number | null;
  saleZone: string | null;
  previousUnitCopper: number | null;
  previousZone: string | null;
  savedZone: string | null;
  askReplace: boolean;
};

type PriceFilter = "all" | "priced" | "decision" | "unpriced";

type Draft = {
  itemKey: string;
  itemName: string;
  priceId: string | null;
  unitCopper: number | null;
};

export function PriceBook() {
  const { copy, explain } = useI18n();
  const [items, setItems] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<PriceFilter>("all");
  const [itemName, setItemName] = useState("");
  const [parts, setParts] = useState<CoinParts>(EMPTY_COINS);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<PriceImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importNotice, setImportNotice] = useState<{ title: string; body: string } | null>(null);
  const [mnmdbBusy, setMnmdbBusy] = useState(false);
  const [mnmdbMeta, setMnmdbMeta] = useState<MnmdbImportResult | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [body, mnmdb] = await Promise.all([
        api<{ prices: CatalogRow[] }>("/api/prices"),
        api<{ meta: MnmdbImportResult | null }>("/api/prices/mnmdb").catch(() => ({ meta: null })),
      ]);
      setItems(body.prices);
      setMnmdbMeta(mnmdb.meta);
      setError(null);
    } catch (caught) {
      setError(explain(caught, ErrorCode.pricesLoadFailed));
    } finally {
      setLoading(false);
    }
  }, [explain]);

  async function importFromMnmdb() {
    setMnmdbBusy(true);
    setImportNotice(null);
    setError(null);
    try {
      const body = await api<{ result: MnmdbImportResult }>("/api/prices/mnmdb", { method: "POST" });
      setMnmdbMeta(body.result);
      setImportNotice({
        title: copy.prices.mnmdbAttribution,
        body: copy.prices.mnmdbDone(body.result.added, body.result.skippedExisting),
      });
      await load();
    } catch (caught) {
      setError(explain(caught, ErrorCode.mnmdbImportFailed));
    } finally {
      setMnmdbBusy(false);
    }
  }

  useEffect(() => {
    const first = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const needle = filter.trim().toLocaleLowerCase("fr");
  const visible = (items ?? []).filter((row) => {
    const saved = row.unitCopper != null;
    const suggested = row.saleUnitCopper != null;
    if (kind === "priced" && !saved) return false;
    // Only real conflicts: a saved price that differs from the latest sale.
    if (kind === "decision" && !row.askReplace) return false;
    if (kind === "unpriced" && (saved || suggested)) return false;
    if (!needle) return true;
    return row.itemName.toLocaleLowerCase("fr").includes(needle);
  });

  async function addPrice() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/prices", {
        method: "POST",
        body: JSON.stringify({ itemName, unitCopper: coinsToCopper(parts) }),
      });
      setItemName("");
      setParts(EMPTY_COINS);
      await load();
    } catch (caught) {
      setError(explain(caught, ErrorCode.pricesSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function onPickImport(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mode", "preview");
      const response = await fetch("/api/prices/import", { method: "POST", body });
      const payload = (await response.json()) as { preview?: PriceImportPreview; error?: string };
      if (!response.ok) throw new Error(payload.error ?? ErrorCode.pricesImportFailed);
      if (!payload.preview) throw new Error(ErrorCode.pricesImportFailed);
      setImportFile(file);
      setImportPreview(payload.preview);
    } catch (caught) {
      setError(explain(caught, ErrorCode.pricesImportFailed));
      setImportFile(null);
      setImportPreview(null);
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function confirmImport(mode: "keepLocal" | "replaceConflicts") {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", importFile);
      body.set("mode", mode);
      const response = await fetch("/api/prices/import", { method: "POST", body });
      const payload = (await response.json()) as {
        result?: { added: number; replaced: number; skippedConflicts: number };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? ErrorCode.pricesImportFailed);
      if (!payload.result) throw new Error(ErrorCode.pricesImportFailed);
      setImportNotice({
        title: copy.prices.shareTitle,
        body: copy.prices.importDone(
          payload.result.added,
          payload.result.replaced,
          payload.result.skippedConflicts,
        ),
      });
      setImportPreview(null);
      setImportFile(null);
      await load();
    } catch (caught) {
      setError(explain(caught, ErrorCode.pricesImportFailed));
    } finally {
      setImporting(false);
    }
  }

  async function runRow(key: string, task: () => Promise<void>, fallback: ErrorCodeName = ErrorCode.pricesSaveFailed) {
    setBusyKey(key);
    setError(null);
    try {
      await task();
      await load();
    } catch (caught) {
      setError(explain(caught, fallback));
    } finally {
      setBusyKey(null);
    }
  }

  const filters: Array<{ id: PriceFilter; label: string }> = [
    { id: "all", label: copy.prices.showAll },
    { id: "priced", label: copy.prices.withPrice },
    { id: "decision", label: copy.prices.needsDecision },
    { id: "unpriced", label: copy.prices.withoutPrice },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title={copy.prices.title} subtitle={copy.prices.intro} />

      <Card>
        <CardHeader>
          <CardTitle as="h3">{copy.prices.addTitle}</CardTitle>
          <CardDescription>{copy.prices.addHelp}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="price-name">{copy.prices.itemName}</Label>
            <Input id="price-name" value={itemName} onChange={(event) => setItemName(event.target.value)} />
          </div>
          <CoinFields idPrefix="new-price" value={parts} onChange={setParts} />
          <div>
            <Button type="button" disabled={saving || !itemName.trim()} onClick={() => void addPrice()}>
              {saving ? copy.common.saving : copy.prices.savePrice}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3">{copy.prices.mnmdbTitle}</CardTitle>
          <CardDescription>{copy.prices.mnmdbHelp}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={mnmdbBusy || importing} onClick={() => void importFromMnmdb()}>
              {mnmdbBusy ? copy.prices.mnmdbBusy : copy.prices.mnmdbImport}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{copy.prices.mnmdbAttribution}</p>
          {mnmdbMeta ? (
            <p className="text-sm text-muted-foreground">
              {copy.prices.mnmdbMeta(new Date(mnmdbMeta.importedAt).toLocaleString(), mnmdbMeta.added)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3">{copy.prices.shareTitle}</CardTitle>
          <CardDescription>{copy.prices.shareHelp}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const link = document.createElement("a");
              link.href = "/api/prices/export";
              link.download = "mnm-loot-spliter-prices.json";
              document.body.appendChild(link);
              link.click();
              link.remove();
            }}
          >
            {copy.prices.export}
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".json,.sqlite,.db,application/json"
            className="sr-only"
            onChange={(event) => void onPickImport(event.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="outline" disabled={importing || mnmdbBusy} onClick={() => importInput.current?.click()}>
            {importing ? copy.prices.importBusy : copy.prices.import}
          </Button>
        </CardContent>
      </Card>

      {importNotice ? (
        <Alert>
          <AlertTitle>{importNotice.title}</AlertTitle>
          <AlertDescription>{importNotice.body}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.prices.unavailable}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {copy.common.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">{copy.prices.loading}</p> : null}

      {!loading && items && items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h3">{copy.prices.emptyTitle}</CardTitle>
            <CardDescription>{copy.prices.emptyBody}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="price-filter">{copy.prices.filter}</Label>
            <Input
              id="price-filter"
              value={filter}
              placeholder={copy.prices.searchHint}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={copy.prices.show}>
            {filters.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={kind === option.id ? "default" : "outline"}
                aria-pressed={kind === option.id}
                onClick={() => setKind(option.id)}
              >
                {option.label}
              </Button>
            ))}
            <p className="text-sm text-muted-foreground">{copy.prices.shown(visible.length)}</p>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.prices.noMatch}</p>
          ) : (
            <ul className="scrollbar-theme grid max-h-[70vh] gap-2 overflow-auto">
              {visible.map((row) => (
                <PriceItem
                  key={row.itemKey}
                  row={row}
                  busy={busyKey === row.itemKey}
                  onSaveSuggested={() => {
                    if (row.saleUnitCopper == null) return;
                    void runRow(row.itemKey, () =>
                      api("/api/prices", {
                        method: "POST",
                        body: JSON.stringify({ itemName: row.itemName, unitCopper: row.saleUnitCopper }),
                      }),
                    );
                  }}
                  onChoose={(choice) => {
                    void runRow(row.itemKey, () =>
                      api("/api/prices/decision", {
                        method: "POST",
                        body: JSON.stringify({ itemName: row.itemName, choice }),
                      }),
                    );
                  }}
                  onEdit={() =>
                    setEditing({
                      itemKey: row.itemKey,
                      itemName: row.itemName,
                      priceId: row.priceId,
                      unitCopper: row.unitCopper,
                    })
                  }
                  onSetPrice={() =>
                    setEditing({
                      itemKey: row.itemKey,
                      itemName: row.itemName,
                      priceId: null,
                      unitCopper: row.saleUnitCopper,
                    })
                  }
                  onDelete={() => {
                    if (!row.priceId) return;
                    void runRow(
                      row.itemKey,
                      () => api(`/api/prices/${row.priceId}`, { method: "DELETE" }),
                      ErrorCode.pricesDeleteFailed,
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {editing ? (
        <PriceDialog
          key={editing.itemKey}
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {importPreview ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !importing) {
              setImportPreview(null);
              setImportFile(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg!">
            <DialogHeader>
              <DialogTitle>{copy.prices.importPreviewTitle}</DialogTitle>
              <DialogDescription>
                {copy.prices.importSummary(
                  importPreview.added,
                  importPreview.unchanged,
                  importPreview.conflicts.length,
                )}
              </DialogDescription>
            </DialogHeader>
            {importPreview.conflicts.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>{copy.prices.importConflictWarn(importPreview.conflicts.length)}</AlertTitle>
                <AlertDescription>
                  <ul className="scrollbar-theme mt-2 grid max-h-48 gap-2 overflow-auto text-sm">
                    {importPreview.conflicts.slice(0, 8).map((row) => (
                      <li key={row.itemKey}>
                        <span className="font-medium">{row.itemName}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {copy.prices.importLocal} <CoinAmount copper={row.localCopper} /> · {copy.prices.importIncoming}{" "}
                          <CoinAmount copper={row.importCopper} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  {importPreview.conflicts.length > 8 ? (
                    <p className="mt-2">{copy.prices.importMore(importPreview.conflicts.length - 8)}</p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                type="button"
                disabled={importing || (importPreview.added === 0 && importPreview.conflicts.length === 0)}
                onClick={() => void confirmImport("keepLocal")}
              >
                {copy.prices.importKeepLocal}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={importing || importPreview.conflicts.length === 0}
                onClick={() => void confirmImport("replaceConflicts")}
              >
                {copy.prices.importReplace}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={importing}
                onClick={() => {
                  setImportPreview(null);
                  setImportFile(null);
                }}
              >
                {copy.common.cancel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function PriceItem({
  row,
  busy,
  onSaveSuggested,
  onChoose,
  onEdit,
  onSetPrice,
  onDelete,
}: {
  row: CatalogRow;
  busy: boolean;
  onSaveSuggested: () => void;
  onChoose: (choice: "keep" | "replace" | "keepPrevious") => void;
  onEdit: () => void;
  onSetPrice: () => void;
  onDelete: () => void;
}) {
  const { copy } = useI18n();
  const saved = row.unitCopper;
  const suggested = saved == null && row.saleUnitCopper != null;
  const uneven = row.saleCopper != null && row.saleUnitCopper == null && row.saleQuantity != null;
  const noAmount = saved == null && row.saleQuantity != null && row.saleCopper == null;

  return (
    <li>
      <Card size="sm">
        <CardContent className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid gap-1">
              <p className="font-medium">{row.itemName}</p>
              {saved != null ? (
                <p className="text-sm text-muted-foreground">
                  {copy.prices.savedPrice} <CoinAmount copper={saved} /> {copy.prices.each}
                  {row.savedZone ? <ZoneNote zone={row.savedZone} /> : null}
                </p>
              ) : (
                <UnknownPrice />
              )}
              {row.previousUnitCopper != null ? (
                <p className="text-sm">
                  {copy.prices.previousSale} <CoinAmount copper={row.previousUnitCopper} /> {copy.prices.each}
                  {row.previousZone ? <ZoneNote zone={row.previousZone} /> : null}
                </p>
              ) : null}
              {suggested && row.saleUnitCopper != null ? (
                <p className="text-sm">
                  {copy.prices.suggestedPrice} <CoinAmount copper={row.saleUnitCopper} /> {copy.prices.each}
                  {row.saleZone ? <ZoneNote zone={row.saleZone} /> : null}
                </p>
              ) : null}
              {uneven && row.saleQuantity != null && row.saleCopper != null ? (
                <p className="text-sm text-muted-foreground">
                  <CoinPhrase text={copy.prices.saleNoUnit(row.saleQuantity)} amounts={[row.saleCopper]} />
                </p>
              ) : null}
              {noAmount ? <p className="text-sm text-muted-foreground">{copy.prices.saleNoAmount}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {saved == null && suggested ? (
                <Button type="button" size="sm" disabled={busy} onClick={onSaveSuggested}>
                  {copy.prices.saveSuggested}
                </Button>
              ) : null}
              {saved == null ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onSetPrice}>
                  {suggested ? copy.prices.setDifferent : copy.prices.setPrice}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${copy.common.edit} ${row.itemName}`}
                    onClick={onEdit}
                  >
                    {copy.common.edit}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`${copy.common.delete} ${row.itemName}`}
                    onClick={onDelete}
                  >
                    {copy.common.delete}
                  </Button>
                </>
              )}
            </div>
          </div>
          {row.askReplace && saved != null && row.saleUnitCopper != null ? (
            <div className="grid gap-2 rounded-sm border border-[#6e5338]/50 bg-[#f7f3ea] p-3">
              <p className="font-medium">{copy.prices.replaceTitle}</p>
              <p className="text-sm">
                {copy.prices.savedPrice} <CoinAmount copper={saved} /> {copy.prices.each}
                {row.savedZone ? <ZoneNote zone={row.savedZone} /> : null}
              </p>
              <p className="text-sm">
                {copy.prices.suggestedPrice} <CoinAmount copper={row.saleUnitCopper} /> {copy.prices.each}
                {row.saleZone ? <ZoneNote zone={row.saleZone} /> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  aria-label={`${copy.prices.replaceWithSale}: ${row.itemName}`}
                  onClick={() => onChoose("replace")}
                >
                  {copy.prices.replaceWithSale}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-label={`${copy.prices.keepPrice}: ${row.itemName}`}
                  onClick={() => onChoose("keep")}
                >
                  {copy.prices.keepPrice}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

function ZoneNote({ zone }: { zone: string }) {
  const { copy } = useI18n();
  return <span className="text-muted-foreground"> · {copy.prices.inZone(zone)}</span>;
}

function PriceDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { copy, explain } = useI18n();
  const [itemName, setItemName] = useState(draft.itemName);
  const [coinParts, setCoinParts] = useState<CoinParts>(
    draft.unitCopper == null ? EMPTY_COINS : copperToCoins(draft.unitCopper),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const creating = draft.priceId == null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle>{creating ? copy.prices.setPrice : copy.prices.editTitle}</DialogTitle>
          <DialogDescription>{creating ? copy.prices.addHelp : copy.prices.editHelp}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {creating ? (
            <p className="font-medium">{draft.itemName}</p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="edit-price-name">{copy.prices.itemName}</Label>
              <Input id="edit-price-name" value={itemName} onChange={(event) => setItemName(event.target.value)} />
            </div>
          )}
          <CoinFields idPrefix="edit-book" value={coinParts} onChange={setCoinParts} disabled={saving} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              const unitCopper = coinsToCopper(coinParts);
              const request = creating
                ? api("/api/prices", {
                    method: "POST",
                    body: JSON.stringify({ itemName: draft.itemName, unitCopper }),
                  })
                : api(`/api/prices/${draft.priceId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ itemName, unitCopper }),
                  });
              void request
                .then(() => onSaved())
                .catch((caught: unknown) => {
                  setError(explain(caught, creating ? ErrorCode.pricesSaveFailed : ErrorCode.pricesEditFailed));
                  setSaving(false);
                });
            }}
          >
            {copy.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
