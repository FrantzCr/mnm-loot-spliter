"use client";

import { Archive, Pencil } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/components/locale";
import { Button } from "@/components/ui/button";
import type { PartySummary } from "@/lib/group";

/** Display name for a group: the user's name, else "Group of <date>". */
export function partyLabel(
  party: Pick<PartySummary, "name" | "startedAt">,
  defaultName: (date: string) => string,
  stamp: (iso: string) => string,
): string {
  return party.name?.trim() || defaultName(stamp(party.startedAt));
}

/**
 * Group header strip: current group's name (inline rename) and a switcher between the
 * active group and closed archives. Archives open read-only.
 */
export function GroupBar({
  parties,
  shownId,
  archived,
  saving,
  onShow,
  onRename,
}: {
  parties: PartySummary[];
  /** Party currently displayed (active or archive), null when no active group and no archive open. */
  shownId: string | null;
  archived: boolean;
  saving: boolean;
  onShow: (partyId: string | null) => void;
  onRename: (partyId: string, name: string) => Promise<boolean>;
}) {
  const { copy, stamp } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = parties.find((party) => party.id === shownId) ?? null;
  const active = parties.find((party) => party.status === "open") ?? null;
  const archives = parties.filter((party) => party.status === "closed");
  const label = (party: PartySummary) => partyLabel(party, copy.group.defaultName, stamp);

  async function submit() {
    if (!shown) return;
    if (await onRename(shown.id, draft)) setEditing(false);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border border-[#6e5338]/45 bg-[#efe6d6]/45 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {archived ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#6e5338]/15 px-2 py-0.5 text-xs text-foreground">
            <Archive className="size-3.5" aria-hidden />
            {copy.group.archivedBadge}
          </span>
        ) : null}
        {shown && editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={60}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
              placeholder={copy.group.defaultName(stamp(shown.startedAt))}
              aria-label={copy.group.renameLabel}
              className="h-8 w-56 rounded-sm border border-[#6e5338]/55 bg-card px-2 font-heading text-base"
            />
            <Button type="submit" size="sm" disabled={saving}>
              {copy.common.save}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              {copy.common.cancel}
            </Button>
          </form>
        ) : shown ? (
          <>
            <h3 className="truncate font-heading text-lg">{label(shown)}</h3>
            <button
              type="button"
              className="rounded-sm p-1 text-muted-foreground hover:bg-[#efe6d6] hover:text-foreground"
              aria-label={copy.group.renameLabel}
              title={copy.group.renameLabel}
              onClick={() => {
                setDraft(shown.name ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          </>
        ) : (
          <h3 className="font-heading text-lg text-muted-foreground">{copy.group.noActiveGroup}</h3>
        )}
      </div>

      {archives.length > 0 ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{copy.group.switchLabel}</span>
          <select
            value={archived && shownId ? shownId : ""}
            onChange={(event) => {
              setEditing(false);
              onShow(event.target.value || null);
            }}
            className="h-8 max-w-64 rounded-sm border border-[#6e5338]/55 bg-card px-2 text-sm text-foreground"
          >
            <option value="">{active ? `${label(active)} · ${copy.group.activeSuffix}` : copy.group.noActiveGroup}</option>
            <optgroup label={copy.group.archivesLabel(archives.length)}>
              {archives.map((party) => (
                <option key={party.id} value={party.id}>
                  {label(party)} · {copy.group.lootSummary(party.lootCount)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ) : null}
    </div>
  );
}
