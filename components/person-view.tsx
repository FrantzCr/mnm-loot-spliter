"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/components/api";
import { CoinAmount, CoinPhrase, COIN_SLOT } from "@/components/coin-amount";
import { CoinFields } from "@/components/coin-fields";
import { ErrorCode, useI18n } from "@/components/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { formatWhen } from "@/lib/format";
import { coinsToCopper, copperToCoins, EMPTY_COINS, type CoinParts } from "@/lib/money";

type LootLine = {
  id: string;
  itemName: string;
  quantity: number;
  lootedAt: string;
  source: string | null;
  zone: string | null;
  note: string | null;
  unitCopper: number | null;
  bookUnitCopper: number | null;
  userEdited: boolean;
};

type Payload = {
  person: { id: string; name: string; serverName: string | null };
  totals: {
    lineCount: number;
    itemCount: number;
    knownValueCopper: number;
    missingPriceCount: number;
  };
  entries: LootLine[];
};

export function PersonView({ id }: { id: string }) {
  const router = useRouter();
  const { copy, explain } = useI18n();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<LootLine | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeLine, setRemoveLine] = useState<LootLine | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Payload>(`/api/people/${id}/loot`);
      setPayload(next);
      setMissing(false);
      setError(null);
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : "";
      if (raw === ErrorCode.personMissing) setMissing(true);
      else setError(explain(caught, ErrorCode.personLoadFailed));
    } finally {
      setLoading(false);
    }
  }, [explain, id]);

  useEffect(() => {
    if (!payload && !missing) return;
    const next = payload ? `${payload.person.name} — ${copy.shell.title}` : `${copy.person.missingTitle} — ${copy.shell.title}`;
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
  }, [payload, missing, copy.shell.title, copy.person.missingTitle]);

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

  const visible = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("fr");
    if (!payload) return [];
    if (!needle) return payload.entries;
    return payload.entries.filter((entry) => entry.itemName.toLocaleLowerCase("fr").includes(needle));
  }, [filter, payload]);

  if (loading && !payload) {
    return (
      <>
        <title>{`${copy.shell.title}`}</title>
        <p className="text-sm text-muted-foreground">{copy.person.loading}</p>
      </>
    );
  }

  if (missing) {
    return (
      <Card>
        <title>{`${copy.person.missingTitle} — ${copy.shell.title}`}</title>
        <CardHeader>
          <CardTitle as="h2">{copy.person.missingTitle}</CardTitle>
          <CardDescription>{copy.person.missingBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/options" />} variant="outline">
            {copy.person.back}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error && !payload) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{copy.person.unavailable}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {copy.common.retry}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!payload) return null;
  const { person, totals } = payload;

  return (
    <div className="grid gap-4">
      <title>{`${person.name} — ${copy.shell.title}`}</title>
      <PageHeader
        eyebrow={
          <Link
            href="/options"
            className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a4503]"
          >
            ← {copy.person.overview}
          </Link>
        }
        title={person.name}
        subtitle={
          <>
            {person.serverName ? copy.person.server(person.serverName) : ""}
            {copy.person.ledgerNote}
          </>
        }
        action={
          <>
            <Button type="button" variant="outline" onClick={() => setRenameOpen(true)}>
              {copy.person.rename}
            </Button>
            <Button type="button" variant="destructive" onClick={() => setRemoveOpen(true)}>
              {copy.person.remove}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.person.refreshFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={copy.person.items} value={String(totals.itemCount)} detail={copy.person.lootLines(totals.lineCount)} />
        <Stat
          label={copy.person.knownValue}
          value={<CoinAmount copper={totals.knownValueCopper} />}
          detail={copy.person.knownDetail}
        />
        <Stat
          label={copy.person.unpriced}
          value={String(totals.missingPriceCount)}
          detail={totals.missingPriceCount === 0 ? copy.person.nothingToFill : copy.person.stillUnpriced}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="filter">{copy.person.filter}</Label>
        <Input
          id="filter"
          value={filter}
          placeholder={copy.person.filterHint}
          onChange={(event) => setFilter(event.target.value)}
        />
        {filter.trim() ? <p className="text-sm text-muted-foreground">{copy.person.filterCount(visible.length)}</p> : null}
      </div>

      {payload.entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h3">{copy.person.noLoot}</CardTitle>
            <CardDescription>{copy.person.noLootBody(person.name)}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {payload.entries.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.person.noMatch}</p>
      ) : null}

      <ul className="grid gap-3">
        {visible.map((entry) => (
          <li key={entry.id}>
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline gap-2">
                  <span>{entry.itemName}</span>
                  <span className="text-sm font-normal text-muted-foreground">× {entry.quantity}</span>
                  {entry.userEdited ? <Badge variant="outline">{copy.person.corrected}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {formatWhen(entry.lootedAt) || copy.person.timeMissing}
                  {entry.source ? ` · ${entry.source}` : ""}
                  {entry.zone ? ` · ${entry.zone}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <p className="text-sm">
                  {entry.unitCopper === null ? (
                    copy.person.unknownPrice
                  ) : (
                    <CoinPhrase
                      text={copy.person.lineValue(COIN_SLOT, COIN_SLOT)}
                      amounts={[entry.unitCopper * entry.quantity, entry.unitCopper]}
                      omitZeros={[false, true]}
                    />
                  )}
                </p>
                {entry.bookUnitCopper !== null && entry.unitCopper !== entry.bookUnitCopper ? (
                  <p className="text-sm text-muted-foreground">
                    <CoinPhrase text={copy.person.bookDiffers(COIN_SLOT)} amounts={[entry.bookUnitCopper]} />
                  </p>
                ) : null}
                {entry.note ? <p className="text-sm text-muted-foreground">{entry.note}</p> : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${copy.person.correct} ${entry.itemName}`}
                    onClick={() => setEditing(entry)}
                  >
                    {copy.person.correct}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${copy.person.remove} ${entry.itemName}`}
                    onClick={() => setRemoveLine(entry)}
                  >
                    {copy.person.remove}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground">{copy.person.stackNote}</p>

      {editing ? (
        <CorrectDialog
          line={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {renameOpen ? (
        <RenameDialog
          name={person.name}
          onClose={() => setRenameOpen(false)}
          onSaved={async (name) => {
            await api(`/api/people/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
            setRenameOpen(false);
            await load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removeOpen}
        title={copy.person.removeCharacter(person.name)}
        body={copy.person.removeCharacterBody}
        confirmLabel={copy.person.remove}
        onClose={() => setRemoveOpen(false)}
        onConfirm={async () => {
          await api(`/api/people/${id}`, { method: "DELETE" });
          router.push("/");
        }}
      />
      <ConfirmDialog
        open={removeLine !== null}
        title={copy.person.removeLine}
        body={copy.person.removeLineBody}
        confirmLabel={copy.person.remove}
        onClose={() => setRemoveLine(null)}
        onConfirm={async () => {
          if (!removeLine) return;
          await api(`/api/loot/${removeLine.id}`, { method: "DELETE" });
          setRemoveLine(null);
          await load();
        }}
      />
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function CorrectDialog({
  line,
  onClose,
  onSaved,
}: {
  line: LootLine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { copy, explain } = useI18n();
  const [itemName, setItemName] = useState(line.itemName);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [source, setSource] = useState(line.source ?? "");
  const [zone, setZone] = useState(line.zone ?? "");
  const [note, setNote] = useState(line.note ?? "");
  const [known, setKnown] = useState(line.unitCopper !== null);
  const [parts, setParts] = useState<CoinParts>(line.unitCopper === null ? EMPTY_COINS : copperToCoins(line.unitCopper));
  const [saveToBook, setSaveToBook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/loot/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          itemName,
          quantity: Number(quantity),
          source,
          zone,
          note,
          priceKnown: known,
          unitCopper: known ? coinsToCopper(parts) : null,
          saveToBook: known && saveToBook,
        }),
      });
      onSaved();
    } catch (caught) {
      setError(explain(caught, ErrorCode.lootCorrectFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle>{copy.person.correctTitle}</DialogTitle>
          <DialogDescription>{copy.person.correctHelp}</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-theme grid max-h-[60vh] gap-3 overflow-y-auto">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-item">{copy.person.item}</Label>
            <Input id="edit-item" value={itemName} onChange={(event) => setItemName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-qty">{copy.person.quantity}</Label>
            <Input
              id="edit-qty"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-source">{copy.person.source}</Label>
            <Input id="edit-source" value={source} onChange={(event) => setSource(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-zone">{copy.person.zone}</Label>
            <Input id="edit-zone" value={zone} onChange={(event) => setZone(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-note">{copy.person.note}</Label>
            <Textarea id="edit-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-[#1a140e]" checked={known} onChange={(event) => setKnown(event.target.checked)} />
            {copy.person.priceKnown}
          </label>
          <CoinFields idPrefix="edit-price" value={parts} onChange={setParts} disabled={!known} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[#1a140e]"
              checked={saveToBook}
              disabled={!known}
              onChange={(event) => setSaveToBook(event.target.checked)}
            />
            {copy.person.saveToBook}
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  name,
  onClose,
  onSaved,
}: {
  name: string;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}) {
  const { copy, explain } = useI18n();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.person.renameTitle}</DialogTitle>
          <DialogDescription>{copy.person.renameHelp}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="rename">{copy.person.name}</Label>
          <Input id="rename" value={value} onChange={(event) => setValue(event.target.value)} />
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
              void onSaved(value).catch((caught: unknown) => {
                setError(explain(caught, ErrorCode.personRenameFailed));
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

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { copy, explain } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onConfirm().catch((caught: unknown) => {
                setError(explain(caught, ErrorCode.personActionFailed));
                setSaving(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
