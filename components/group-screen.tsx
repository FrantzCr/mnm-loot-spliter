"use client";

import { BanknoteArrowDown, BanknoteArrowUp, ChevronDown, User, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { api } from "@/components/api";
import { CoinAmount, CoinPhrase, COIN_SLOT, UnknownPrice } from "@/components/coin-amount";
import { CoinFields } from "@/components/coin-fields";
import { GuestNameInput } from "@/components/guest-name-input";
import { ErrorCode, useI18n } from "@/components/locale";
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
import { Label } from "@/components/ui/label";
import type { Copy } from "@/lib/copy";
import { itemKey, titleCaseName } from "@/lib/format";
import { createGenerationGate } from "@/lib/generation-gate";
import { COIN_LOOT_ITEM_NAME } from "@/lib/ledger-parse";
import { coinsToCopper, copperToCoins, EMPTY_COINS, type CoinParts } from "@/lib/money";
import {
  potSessionTotals,
  settleEveryone,
  settlePresence,
  settlementMembers,
  type BalanceRow,
  type PotLine,
  type SplitComputation,
  type SplitMode,
} from "@/lib/split";
import {
  buildSettlementChatMessages,
  normalizeChatRoundStep,
  readStoredChatRoundStep,
  writeStoredChatRoundStep,
} from "@/lib/settlement-chat";
import { ChatRoundPicker } from "@/components/chat-round-toggle";
import { cn } from "cn";
import {
  stackLootLines,
  stackLootLinesAcrossPeople,
  type LootHolderShare,
  type StackedAcrossPeopleLine,
} from "@/lib/stack-loot";

type PartyPresence = {
  id: string;
  personId: string | null;
  name: string;
  joinedAt: string;
  leftAt: string | null;
  settledAt: string | null;
};

type PartyView = {
  party: null | {
    id: string;
    startedAt: string;
    mode: SplitMode | null;
    presences: PartyPresence[];
  };
  people: Array<{ id: string; name: string; serverName: string | null }>;
  lines: PotLine[];
  split: SplitComputation | null;
};

type DraftGuest = { key: string; name: string; personId?: string | null };

type PendingResaleItem = {
  id: string;
  itemKey: string;
  itemName: string;
  quantity: number;
  unitCopper: number | null;
  lineCopper: number | null;
  partyId: string | null;
  updatedAt: string;
};

type RecentPlayer = {
  name: string;
  personId: string | null;
  lastPlayedAt: string;
  groupStartedAt: string;
};

type Recap = {
  pendingResale: PendingResaleItem[];
  recentPlayers: RecentPlayer[];
  playerSuggestions: RecentPlayer[];
};

/** Keep in sync with `RECENT_PLAYERS_LIMIT` in lib/pending-resale.ts */
const RECENT_PLAYERS_VISIBLE = 10;

function playerKey(player: RecentPlayer): string {
  return `${player.personId ?? "label"}:${player.name}`;
}

function isInOpenGroup(player: RecentPlayer, party: PartyView["party"]): boolean {
  if (!party) return false;
  return party.presences.some((presence) => {
    if (presence.leftAt != null) return false;
    if (player.personId && presence.personId === player.personId) return true;
    return !player.personId && presence.name.toLowerCase() === player.name.toLowerCase();
  });
}

function peopleInPot(lines: PotLine[]): Array<{ id: string; name: string }> {
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const line of lines) {
    if (!names.has(line.personId)) order.push(line.personId);
    names.set(line.personId, line.personName);
  }
  return order.map((id) => ({ id, name: names.get(id) ?? id }));
}

const LOOT_TAB_ALL = "__all__";

/** True when this loot person matches an open seat still in the group. */
function lootPersonActiveInGroup(
  person: { id: string; name: string },
  party: PartyView["party"],
): boolean {
  if (!party) return false;
  return party.presences.some((presence) => {
    if (presence.leftAt != null) return false;
    if (presence.personId != null && presence.personId === person.id) return true;
    return presence.name.toLowerCase() === person.name.toLowerCase();
  });
}

/** True when this loot person matches only departed seats in the open group. */
function lootPersonLeftGroup(
  person: { id: string; name: string },
  party: PartyView["party"],
): boolean {
  if (!party) return false;
  const related = party.presences.filter((presence) => {
    if (presence.personId != null && presence.personId === person.id) return true;
    return presence.name.toLowerCase() === person.name.toLowerCase();
  });
  if (related.length === 0) return false;
  return related.every((presence) => presence.leftAt != null);
}

function lootTabId(personId: string): string {
  return `loot-tab-${personId}`;
}

function lootPanelId(personId: string): string {
  return `loot-panel-${personId}`;
}

export function GroupScreen() {
  const { copy, coins, stamp, explain } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<PartyView | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [guestLabel, setGuestLabel] = useState("");
  const [guestPersonId, setGuestPersonId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [guests, setGuests] = useState<DraftGuest[]>([]);
  const [leaving, setLeaving] = useState<PartyPresence | null>(null);
  const [settling, setSettling] = useState<PartyPresence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const draftQueryConsumed = useRef(false);
  const viewGate = useRef(createGenerationGate()).current;
  const savingRef = useRef(false);
  const [pricing, setPricing] = useState<PotLine | null>(null);
  const [priceParts, setPriceParts] = useState<CoinParts>(EMPTY_COINS);
  const [lootPersonId, setLootPersonId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(true);
  const [potOpen, setPotOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);

  const load = useCallback(async () => {
    const token = viewGate.snapshot();
    try {
      const [next, recapBody] = await Promise.all([api<PartyView>("/api/group"), api<Recap>("/api/recap")]);
      if (!viewGate.isCurrent(token)) return;
      setView(next);
      setRecap(recapBody);
      setError(null);
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.groupLoadFailed));
    } finally {
      if (viewGate.isCurrent(token)) setLoading(false);
    }
  }, [explain, viewGate]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    if (!view || draftQueryConsumed.current) return;
    const addPersonId = searchParams.get("addPersonId");
    const addLabel = searchParams.get("addLabel")?.trim() ?? "";
    if (!addPersonId && !addLabel) return;
    draftQueryConsumed.current = true;
    router.replace("/group");

    if (view.party) {
      const already = view.party.presences.some((presence) => {
        if (presence.leftAt != null) return false;
        if (addPersonId && presence.personId === addPersonId) return true;
        return addLabel !== "" && presence.name.toLowerCase() === addLabel.toLowerCase();
      });
      if (already) return;
      const body = addPersonId ? { personId: addPersonId } : { label: addLabel };
      void (async () => {
        setSaving(true);
        setError(null);
        viewGate.bump();
        const token = viewGate.snapshot();
        try {
          const next = await api<PartyView>("/api/group/presence", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (!viewGate.isCurrent(token)) return;
          setView(next);
          setNotice(copy.home.playersAdded(addLabel || next.party?.presences.at(-1)?.name || ""));
        } catch (caught) {
          if (!viewGate.isCurrent(token)) return;
          setError(explain(caught, ErrorCode.memberAddFailed));
        } finally {
          setSaving(false);
        }
      })();
      return;
    }

    const personOnMachine = Boolean(addPersonId && view.people.some((person) => person.id === addPersonId));
    const displayName =
      (personOnMachine && addPersonId
        ? view.people.find((person) => person.id === addPersonId)?.name
        : null) ?? addLabel;
    const timer = window.setTimeout(() => {
      if (personOnMachine && addPersonId) {
        setCheckedIds([addPersonId]);
        if (displayName) setNotice(copy.home.playersDraftAdded(displayName));
        return;
      }
      if (!addLabel) return;
      setGuests((current) => {
        const exists = current.some(
          (guest) =>
            (addPersonId && guest.personId === addPersonId) ||
            guest.name.toLowerCase() === addLabel.toLowerCase(),
        );
        if (exists) return current;
        return [...current, { key: crypto.randomUUID(), name: titleCaseName(addLabel), personId: addPersonId }];
      });
      setNotice(copy.home.playersDraftAdded(titleCaseName(addLabel)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [view, searchParams, router, copy.home, explain, viewGate]);

  useEffect(() => {
    if (!notice) return;
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 3500);
  }, [notice]);

  useEffect(() => {
    const first = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      if (savingRef.current) return;
      void load();
    }, 4000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function start(members: Array<{ personId?: string; label?: string }>) {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group", {
        method: "POST",
        body: JSON.stringify({ members }),
      });
      if (!viewGate.isCurrent(token)) return;
      setView(next);
      setCheckedIds([]);
      setGuests([]);
      setGuestLabel("");
      setGuestPersonId(null);
      await load();
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.groupStartFailed));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group", { method: "DELETE" });
      if (!viewGate.isCurrent(token)) return;
      setView(next);
      setResetOpen(false);
      await load();
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.groupResetFailed));
    } finally {
      setSaving(false);
    }
  }

  async function saveUnitPrice() {
    if (!pricing) return;
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      await api("/api/prices", {
        method: "POST",
        body: JSON.stringify({ itemName: pricing.itemName, unitCopper: coinsToCopper(priceParts) }),
      });
      if (!viewGate.isCurrent(token)) return;
      setPricing(null);
      await load();
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.pricesSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function addMember(from?: { name: string; personId: string | null }) {
    const label = titleCaseName((from?.name ?? guestLabel).trim());
    if (!label) return;
    const linkedId = from ? from.personId : guestPersonId;
    const personOnMachine = Boolean(linkedId && view?.people.some((person) => person.id === linkedId));
    const body = personOnMachine && linkedId ? { personId: linkedId } : { label };
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group/presence", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!viewGate.isCurrent(token)) return;
      setView(next);
      setGuestLabel("");
      setGuestPersonId(null);
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.memberAddFailed));
    } finally {
      setSaving(false);
    }
  }

  async function leave(id: string) {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>(`/api/group/presence/${id}/leave`, { method: "POST" });
      if (!viewGate.isCurrent(token)) return false;
      setView(next);
      setLeaving(null);
      return true;
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return false;
      setError(explain(caught, ErrorCode.leaveFailed));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function settle(id: string) {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>(`/api/group/presence/${id}/settle`, { method: "POST" });
      if (!viewGate.isCurrent(token)) return null;
      setView(next);
      setSettling(null);
      return next;
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return null;
      setError(explain(caught, ErrorCode.settleFailed));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function settleAndLeave(id: string) {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    let settledOk = false;
    try {
      const settled = await api<PartyView>(`/api/group/presence/${id}/settle`, { method: "POST" });
      if (!viewGate.isCurrent(token)) return;
      setView(settled);
      settledOk = true;
      const left = await api<PartyView>(`/api/group/presence/${id}/leave`, { method: "POST" });
      if (!viewGate.isCurrent(token)) return;
      setView(left);
      setLeaving(null);
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, settledOk ? ErrorCode.leaveFailed : ErrorCode.settleFailed));
    } finally {
      setSaving(false);
    }
  }

  async function chooseMode(nextMode: SplitMode) {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group/split", {
        method: "POST",
        body: JSON.stringify({ mode: nextMode }),
      });
      if (!viewGate.isCurrent(token)) return;
      setView(next);
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.modeFailed));
    } finally {
      setSaving(false);
    }
  }

  async function settleEveryone() {
    setSaving(true);
    setError(null);
    setNotice(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group/settle", { method: "POST" });
      if (!viewGate.isCurrent(token)) return;
      setView(next);
      setNotice(copy.group.settleEveryoneDone);
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.settleAllFailed));
    } finally {
      setSaving(false);
    }
  }

  function toggleCharacter(personId: string) {
    setCheckedIds((current) => (current[0] === personId ? [] : [personId]));
  }

  function addDraftGuest(from?: { name: string; personId: string | null }) {
    const name = titleCaseName((from?.name ?? guestLabel).trim());
    if (!name) return;
    const candidateId = from ? from.personId : guestPersonId;
    const personOnMachine = Boolean(candidateId && view?.people.some((person) => person.id === candidateId));
    const linkedId = personOnMachine ? candidateId : null;
    setGuests((current) => {
      const exists = current.some(
        (guest) =>
          (linkedId && guest.personId === linkedId) || guest.name.toLowerCase() === name.toLowerCase(),
      );
      if (exists) return current;
      return [...current, { key: crypto.randomUUID(), name, personId: linkedId }];
    });
    setGuestLabel("");
    setGuestPersonId(null);
  }

  function onGuestNameChange(name: string, personId: string | null) {
    setGuestLabel(name);
    setGuestPersonId(personId);
  }

  async function dismissPending(id: string) {
    setDismissingId(id);
    setError(null);
    try {
      await api(`/api/pending-resale/${id}`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(explain(caught, ErrorCode.pendingDismissFailed));
    } finally {
      setDismissingId(null);
    }
  }

  async function dismissAllPending() {
    setDismissingAll(true);
    setError(null);
    try {
      await api("/api/pending-resale", { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(explain(caught, ErrorCode.pendingDismissAllFailed));
    } finally {
      setDismissingAll(false);
    }
  }

  async function dismissRecentPlayerFromList(player: RecentPlayer) {
    const key = playerKey(player);
    setAddingKey(key);
    setError(null);
    try {
      await api("/api/recent-players", {
        method: "DELETE",
        body: JSON.stringify({ name: player.name, personId: player.personId }),
      });
      setRecap((current) => {
        if (!current) return current;
        const drop = (entry: RecentPlayer) => playerKey(entry) !== key;
        return {
          ...current,
          recentPlayers: current.recentPlayers.filter(drop),
          playerSuggestions: current.playerSuggestions.filter(drop),
        };
      });
    } catch (caught) {
      setError(explain(caught, ErrorCode.recentPlayerDismissFailed));
    } finally {
      setAddingKey(null);
    }
  }

  async function addRecentToGroup(player: RecentPlayer) {
    const key = playerKey(player);
    if (isInOpenGroup(player, view?.party ?? null)) return;

    if (view?.party) {
      setAddingKey(key);
      setError(null);
      viewGate.bump();
      const token = viewGate.snapshot();
      try {
        const body = player.personId ? { personId: player.personId } : { label: player.name };
        const next = await api<PartyView>("/api/group/presence", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!viewGate.isCurrent(token)) return;
        setView(next);
        setNotice(copy.home.playersAdded(player.name));
      } catch (caught) {
        if (!viewGate.isCurrent(token)) return;
        setError(explain(caught, ErrorCode.memberAddFailed));
      } finally {
        setAddingKey(null);
      }
      return;
    }

    if (!view) return;

    const personOnMachine = Boolean(player.personId && view.people.some((person) => person.id === player.personId));
    if (personOnMachine && player.personId) {
      setCheckedIds([player.personId]);
      setNotice(copy.home.playersDraftAdded(player.name));
      return;
    }

    setGuests((current) => {
      const exists = current.some(
        (guest) =>
          (player.personId && guest.personId === player.personId) ||
          guest.name.toLowerCase() === player.name.toLowerCase(),
      );
      if (exists) return current;
      return [...current, { key: crypto.randomUUID(), name: player.name, personId: player.personId }];
    });
    setNotice(copy.home.playersDraftAdded(player.name));
  }

  const party = view?.party ?? null;
  const pending = recap?.pendingResale ?? [];
  const recentPlayers = (recap?.recentPlayers ?? []).slice(0, RECENT_PLAYERS_VISIBLE);
  const playerSuggestions = recap?.playerSuggestions ?? recap?.recentPlayers ?? [];
  const draftMembers = view && !party ? draftRoster(view, checkedIds, guests) : [];
  const recentToAdd = recentPlayers.filter((player) => {
    if (isInOpenGroup(player, party)) return false;
    return !draftMembers.some(
      (member) =>
        (player.personId && member.personId === player.personId) ||
        member.name.toLowerCase() === player.name.toLowerCase(),
    );
  });
  const lines = view?.lines ?? [];
  // Item loot only — corpse coins stay out of primary worth / /split (see docs/release-next.md).
  const { lootCopper: knownValue } = potSessionTotals(lines);
  const missing = lines.filter(
    (line) => line.unitCopper == null && !isCorpseCoins(line.itemName),
  ).length;
  const unpricedLootCount = missing;
  // After Record everyone (no remaining tips), drop unpriced noise from Overview.
  const splitSettledQuiet =
    !!view?.split &&
    view.split.mode === "value" &&
    view.split.transfers.length === 0 &&
    view.split.settled.length > 0;
  const showUnpricedOverview = unpricedLootCount > 0 && !splitSettledQuiet;

  function dismissClose() {
    if (saving) return;
    setCloseOpen(false);
  }

  async function closeGroup() {
    setSaving(true);
    setError(null);
    viewGate.bump();
    const token = viewGate.snapshot();
    try {
      const next = await api<PartyView>("/api/group/close", { method: "POST" });
      if (!viewGate.isCurrent(token)) return;
      setCloseOpen(false);
      setView(next);
      await load();
    } catch (caught) {
      if (!viewGate.isCurrent(token)) return;
      setError(explain(caught, ErrorCode.groupCloseFailed));
    } finally {
      setSaving(false);
    }
  }
  const lootPeople = peopleInPot(lines);
  const lootTabIds = lines.length > 0 ? [LOOT_TAB_ALL, ...lootPeople.map((person) => person.id)] : [];
  const selectedLootPersonId =
    lootPersonId != null && lootTabIds.includes(lootPersonId)
      ? lootPersonId
      : (lootTabIds[0] ?? null);
  const stackedLoot = stackLootLines(lines);
  const activeLootPersonIds = new Set(
    lootPeople.filter((person) => lootPersonActiveInGroup(person, party)).map((person) => person.id),
  );
  const allActiveLoot = stackLootLinesAcrossPeople(
    lines.filter((line) => activeLootPersonIds.has(line.personId)),
  );
  /** One pass — priced item worth per person for compact tab labels (no corpse coins). */
  const lootWorthByPerson = new Map<string, number>();
  for (const line of lines) {
    if (line.unitCopper == null || isCorpseCoins(line.itemName)) continue;
    lootWorthByPerson.set(
      line.personId,
      (lootWorthByPerson.get(line.personId) ?? 0) + line.quantity * line.unitCopper,
    );
  }
  let allActiveLootWorth = 0;
  for (const personId of activeLootPersonIds) {
    allActiveLootWorth += lootWorthByPerson.get(personId) ?? 0;
  }

  function onLootTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = lootTabIds.length;
    if (count === 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const id = lootTabIds[next];
    if (!id) return;
    setLootPersonId(id);
    document.getElementById(lootTabId(id))?.focus();
  }

  return (
    <div className="grid gap-4">
      <PageHeader title={copy.group.title} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{copy.group.title}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>{copy.group.title}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">{copy.group.loading}</p> : null}

      {view ? (
        <Card>
          <CardHeader className={party ? "gap-2" : undefined}>
            {party ? (
              <button
                type="button"
                id="group-members-card-heading"
                className="flex w-full items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#7a4503]/40"
                aria-expanded={membersOpen}
                aria-controls="group-members-block"
                aria-label={
                  membersOpen ? copy.group.membersHideDetails : copy.group.membersShowDetails
                }
                onClick={() => setMembersOpen((open) => !open)}
              >
                <CardTitle as="h3">{copy.group.members}</CardTitle>
                <ChevronDown
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                    membersOpen ? "rotate-180" : "rotate-0",
                  )}
                  aria-hidden
                />
              </button>
            ) : (
              <CardTitle as="h3">{copy.group.members}</CardTitle>
            )}
            <CardDescription>
              {party ? (
                membersOpen ? (
                  <>
                    {copy.group.since(stamp(party.startedAt))} {copy.group.lootSummary(lines.length)}.{" "}
                    <CoinPhrase
                      text={copy.group.knownValue(COIN_SLOT)}
                      amounts={[knownValue]}
                    />
                    {"."}
                    {missing > 0 ? (
                      <>
                        <br />
                        {copy.group.missingValue(missing)}
                      </>
                    ) : null}{" "}
                    {copy.group.lateJoin}
                  </>
                ) : (
                  <CoinPhrase
                    text={copy.group.membersCollapsedSummary(
                      stamp(party.startedAt),
                      lines.length,
                      COIN_SLOT,
                    )}
                    amounts={[knownValue]}
                  />
                )
              ) : (
                copy.group.draftHelp
              )}
            </CardDescription>
          </CardHeader>
          <CardContent
            id={party ? "group-members-block" : undefined}
            className="grid gap-4"
          >
            {!party ? (
              <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-0">
                <section className="grid min-w-0 gap-3 md:pr-6" aria-labelledby="group-machine-heading">
                  <div className="grid gap-1">
                    <h3 id="group-machine-heading" className="font-heading text-sm font-medium">
                      {copy.group.machine}
                    </h3>
                    <p className="text-sm text-muted-foreground">{copy.group.machineHelp}</p>
                  </div>
                  {view.people.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.group.machineEmpty}</p>
                  ) : (
                    <ul className="grid gap-2">
                      {view.people.map((person) => {
                        const checked = checkedIds.includes(person.id);
                        return (
                          <li key={person.id}>
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="size-5 accent-[#1a140e]"
                                checked={checked}
                                disabled={saving}
                                onChange={() => toggleCharacter(person.id)}
                              />
                              <span>
                                {person.name}
                                {person.serverName ? ` · ${person.serverName}` : ""}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section
                  className="grid min-w-0 gap-3 md:border-l md:border-[#6e5338]/40 md:pl-6"
                  aria-labelledby="group-members-list-heading"
                >
                  <h3 id="group-members-list-heading" className="font-heading text-sm font-medium">
                    {copy.group.membersList}
                  </h3>
                  {draftRoster(view, checkedIds, guests).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy.group.noneYet}</p>
                  ) : (
                    <ul className="grid gap-2 text-sm">
                      {draftRoster(view, checkedIds, guests).map((member) => (
                        <li
                          key={member.key}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
                        >
                          <span>{member.name}</span>
                          {member.guestKey ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              onClick={() =>
                                setGuests((current) => current.filter((guest) => guest.key !== member.guestKey))
                              }
                            >
                              {copy.common.remove}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (saving || guestLabel.trim() === "") return;
                      addDraftGuest();
                    }}
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor="draft-name">{copy.group.otherPlayer}</Label>
                      <GuestNameInput
                        id="draft-name"
                        value={guestLabel}
                        placeholder={copy.group.nameInGroup}
                        suggestions={playerSuggestions}
                        listLabel={copy.group.nameSuggestions}
                        disabled={saving}
                        onChange={onGuestNameChange}
                        onEnterCommit={(name, personId) => {
                          if (saving) return;
                          addDraftGuest({ name, personId });
                        }}
                      />
                    </div>
                    <Button type="submit" variant="outline" disabled={saving || guestLabel.trim() === ""}>
                      {copy.group.addToList}
                    </Button>
                  </form>
                  <RecentPlayersBesideAdd
                    players={recentToAdd}
                    addingKey={addingKey}
                    saving={saving}
                    copy={copy}
                    onAdd={(player) => void addRecentToGroup(player)}
                    onDismiss={(player) => void dismissRecentPlayerFromList(player)}
                  />
                  <Button
                    type="button"
                    disabled={saving || loading || draftRoster(view, checkedIds, guests).length === 0}
                    onClick={() =>
                      void start(
                        draftRoster(view, checkedIds, guests).map((member) =>
                          member.personId ? { personId: member.personId } : { label: member.name },
                        ),
                      )
                    }
                  >
                    {copy.group.start}
                  </Button>
                </section>
              </div>
            ) : (
              <section className="grid gap-3" aria-labelledby="group-members-card-heading">
                {(() => {
                  const active = party.presences.filter((presence) => presence.leftAt == null);
                  const departed = party.presences.filter((presence) => presence.leftAt != null);
                  const renderPresence = (
                    presence: (typeof party.presences)[number],
                    here: boolean,
                  ) => {
                    const row = view.split?.balances.find((balance) => balance.key === presence.id);
                    return (
                      <li
                        key={presence.id}
                        className={[
                          "grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border pb-2",
                          here ? "" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <p className="inline-flex items-center gap-1.5">
                            {here ? (
                              <User
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            ) : null}
                            <span>
                              {presence.name}
                              <span className="text-muted-foreground">
                                {" "}
                                ·{" "}
                                {here
                                  ? copy.group.arrived(stamp(presence.joinedAt))
                                  : copy.group.left(stamp(presence.leftAt ?? ""))}
                              </span>
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {here ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={saving}
                              aria-label={`${copy.group.leave} ${presence.name}`}
                              onClick={() => setLeaving(presence)}
                            >
                              {copy.group.leave}
                            </Button>
                          ) : null}
                          {row && row.balanceCopper !== 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={saving}
                              aria-label={`${copy.group.settle} ${presence.name}`}
                              onClick={() => setSettling(presence)}
                            >
                              {copy.group.settle}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  };

                  if (!membersOpen) {
                    if (active.length === 0) {
                      return <p className="text-sm text-muted-foreground">{copy.group.nobody}</p>;
                    }
                    return (
                      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-sm">
                        {active.map((presence) => (
                          <li key={presence.id} className="inline-flex items-center gap-1.5">
                            <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span>{presence.name}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }

                  if (party.presences.length === 0) {
                    return <p className="text-sm text-muted-foreground">{copy.group.nobody}</p>;
                  }

                  return (
                    <>
                      <div className="grid gap-2">
                        <h3 id="group-members-list-heading" className="font-heading text-sm font-medium">
                          {copy.group.membersList}
                        </h3>
                        {active.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{copy.group.nobody}</p>
                        ) : (
                          <ul className="grid gap-2 text-sm md:grid-cols-2 md:gap-x-6">
                            {active.map((presence) => renderPresence(presence, true))}
                          </ul>
                        )}
                      </div>
                      {departed.length > 0 ? (
                        <div className="mt-2 grid gap-2 border-t border-[#6e5338]/40 pt-4">
                          <h3 className="font-heading text-sm font-medium text-muted-foreground">
                            {copy.group.membersLeft}
                          </h3>
                          <ul className="grid gap-2 text-sm md:grid-cols-2 md:gap-x-6">
                            {departed.map((presence) => renderPresence(presence, false))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  );
                })()}

                {membersOpen ? (
                  <>
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (saving || guestLabel.trim() === "") return;
                        void addMember();
                      }}
                    >
                      <div className="grid gap-1.5">
                        <Label htmlFor="add-member">{copy.group.addMember}</Label>
                        <GuestNameInput
                          id="add-member"
                          value={guestLabel}
                          placeholder={copy.group.nameInGroup}
                          suggestions={playerSuggestions}
                          listLabel={copy.group.nameSuggestions}
                          disabled={saving}
                          onChange={onGuestNameChange}
                          onEnterCommit={(name, personId) => {
                            if (saving) return;
                            void addMember({ name, personId });
                          }}
                        />
                      </div>
                      <Button type="submit" variant="outline" disabled={saving || guestLabel.trim() === ""}>
                        {copy.common.add}
                      </Button>
                    </form>
                    <RecentPlayersBesideAdd
                      players={recentToAdd}
                      addingKey={addingKey}
                      saving={saving}
                      copy={copy}
                      onAdd={(player) => void addRecentToGroup(player)}
                      onDismiss={(player) => void dismissRecentPlayerFromList(player)}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={saving}
                        onClick={() => setCloseOpen(true)}
                      >
                        {copy.group.close}
                      </Button>
                      <Button type="button" variant="destructive" disabled={saving} onClick={() => setResetOpen(true)}>
                        {copy.group.reset}
                      </Button>
                    </div>
                  </>
                ) : null}
              </section>
            )}
          </CardContent>
        </Card>
      ) : null}

      {party ? (
        <Card>
          <CollapsibleCardHeader
            headingId="group-pot-heading"
            panelId="group-pot-block"
            title={copy.group.pot}
            open={potOpen}
            onToggle={() => setPotOpen((open) => !open)}
            showLabel={copy.group.collapseShow}
            hideLabel={copy.group.collapseHide}
            openDescription={copy.group.potHelp}
            closedDescription={
              lines.length === 0 ? (
                copy.group.potEmpty
              ) : (
                <>
                  <CoinPhrase
                    text={copy.group.potCollapsedSummary(lines.length, COIN_SLOT)}
                    amounts={[knownValue]}
                  />
                  {showUnpricedOverview ? (
                    <>
                      {" · "}
                      {copy.group.potCollapsedUnpriced(unpricedLootCount)}
                    </>
                  ) : null}
                </>
              )
            }
          />
          {potOpen ? (
          <CardContent id="group-pot-block" className={lines.length === 0 ? undefined : "grid gap-3"}>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.group.potEmpty}</p>
            ) : (
              <>
                {(() => {
                  if (!showUnpricedOverview) return null;
                  const unpricedLoot = stackLootLinesAcrossPeople(
                    lines.filter((line) => line.unitCopper == null && !isCorpseCoins(line.itemName)),
                  );
                  if (unpricedLoot.length === 0) return null;
                  return (
                    <div className="grid gap-2 rounded-sm border border-[#6e5338]/55 bg-[#efe6d6]/60 p-3">
                      <div className="grid gap-0.5">
                        <h4 className="font-heading text-base font-medium text-foreground">
                          {copy.group.unpricedSession}
                          <span className="ml-2 font-body text-sm font-normal text-muted-foreground">
                            ({unpricedLoot.length})
                          </span>
                        </h4>
                        <p className="text-sm text-muted-foreground">{copy.group.unpricedSessionHelp}</p>
                      </div>
                      <ul className="scrollbar-theme grid max-h-48 gap-2 overflow-auto text-sm">
                        {unpricedLoot.map((line) => (
                          <li
                            key={`unpriced-${line.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2 last:border-b-0 last:pb-0"
                          >
                            <span>
                              {lootLineLabel(line.itemName, copy)}
                              {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                              <span className="text-muted-foreground"> · {line.personName}</span>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-auto"
                              disabled={saving}
                              aria-label={`${copy.group.setUnitPrice} ${line.itemName}`}
                              onClick={() => {
                                setPricing(line);
                                setPriceParts(EMPTY_COINS);
                              }}
                            >
                              <UnknownPrice />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-2" role="tablist" aria-label={copy.group.potTabs} aria-orientation="horizontal">
                  <Button
                    id={lootTabId(LOOT_TAB_ALL)}
                    type="button"
                    role="tab"
                    variant={selectedLootPersonId === LOOT_TAB_ALL ? "default" : "outline"}
                    className="gap-1.5"
                    aria-selected={selectedLootPersonId === LOOT_TAB_ALL}
                    aria-controls={lootPanelId(LOOT_TAB_ALL)}
                    tabIndex={selectedLootPersonId === LOOT_TAB_ALL ? 0 : -1}
                    aria-label={`${copy.group.potTabAllHelp}, ${coins(allActiveLootWorth)}`}
                    onClick={() => setLootPersonId(LOOT_TAB_ALL)}
                    onKeyDown={(event) => onLootTabKeyDown(event, 0)}
                  >
                    {copy.group.potTabAll}
                    <CoinAmount
                      copper={allActiveLootWorth}
                      omitZeros
                      className="text-[0.6875rem] font-normal opacity-90"
                    />
                  </Button>
                  {lootPeople.map((person, index) => {
                    const selected = person.id === selectedLootPersonId;
                    const left = lootPersonLeftGroup(person, party);
                    const worth = lootWorthByPerson.get(person.id) ?? 0;
                    return (
                      <Button
                        key={person.id}
                        id={lootTabId(person.id)}
                        type="button"
                        role="tab"
                        variant={selected ? "default" : "outline"}
                        className={cn("gap-1.5", left ? "opacity-55" : undefined)}
                        aria-selected={selected}
                        aria-controls={lootPanelId(person.id)}
                        tabIndex={selected ? 0 : -1}
                        aria-label={
                          left
                            ? `${copy.group.potTab(person.name)} · ${copy.group.membersLeft}, ${coins(worth)}`
                            : `${copy.group.potTab(person.name)}, ${coins(worth)}`
                        }
                        onClick={() => setLootPersonId(person.id)}
                        onKeyDown={(event) => onLootTabKeyDown(event, index + 1)}
                      >
                        {person.name}
                        <CoinAmount
                          copper={worth}
                          omitZeros
                          className="text-[0.6875rem] font-normal opacity-90"
                        />
                      </Button>
                    );
                  })}
                </div>
                <div
                  role="tabpanel"
                  id={lootPanelId(LOOT_TAB_ALL)}
                  aria-labelledby={lootTabId(LOOT_TAB_ALL)}
                  hidden={selectedLootPersonId !== LOOT_TAB_ALL}
                >
                  <ul className="scrollbar-theme grid max-h-80 gap-2 overflow-auto text-sm">
                    {allActiveLoot.map((line) => (
                      <li
                        key={`all-${line.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
                      >
                        <span className="min-w-0">
                          {lootLineLabel(line.itemName, copy)}
                          {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                          <span className="text-muted-foreground">
                            {" · "}
                            <LootHolderNames line={line} />
                          </span>
                        </span>
                        {isCorpseCoins(line.itemName) ? (
                          <LootLinePriceDisplay line={line} />
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-auto"
                            disabled={saving}
                            aria-label={`${copy.group.setUnitPrice} ${line.itemName}, ${lootPriceLabel(line, copy, coins)}`}
                            onClick={() => {
                              setPricing(line);
                              setPriceParts(
                                line.unitCopper == null ? EMPTY_COINS : copperToCoins(line.unitCopper),
                              );
                            }}
                          >
                            <LootLinePriceDisplay line={line} />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                {lootPeople.map((person) => {
                  const left = lootPersonLeftGroup(person, party);
                  return (
                    <div
                      key={person.id}
                      role="tabpanel"
                      id={lootPanelId(person.id)}
                      aria-labelledby={lootTabId(person.id)}
                      hidden={person.id !== selectedLootPersonId}
                      className={left ? "opacity-55" : undefined}
                    >
                      <ul className="scrollbar-theme grid max-h-80 gap-2 overflow-auto text-sm">
                        {stackedLoot
                          .filter((line) => line.personId === person.id)
                          .map((line) => (
                            <li
                              key={line.id}
                              className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
                            >
                              <span>
                                {lootLineLabel(line.itemName, copy)}
                                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                                <span className="text-muted-foreground"> · {line.personName}</span>
                              </span>
                              {isCorpseCoins(line.itemName) ? (
                                <LootLinePriceDisplay line={line} />
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-auto"
                                  disabled={saving}
                                  aria-label={`${copy.group.setUnitPrice} ${line.itemName}, ${lootPriceLabel(line, copy, coins)}`}
                                  onClick={() => {
                                    setPricing(line);
                                    setPriceParts(
                                      line.unitCopper == null ? EMPTY_COINS : copperToCoins(line.unitCopper),
                                    );
                                  }}
                                >
                                  <LootLinePriceDisplay line={line} />
                                </Button>
                              )}
                            </li>
                          ))}
                      </ul>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
          ) : null}
        </Card>
      ) : null}

      {view?.split ? (
        <SplitResult
          split={view.split}
          lines={lines}
          saving={saving}
          onMode={(mode) => void chooseMode(mode)}
          onSettleEveryone={() => void settleEveryone()}
        />
      ) : null}

      {leaving && view?.split ? (
        <LeaveDialog
          presence={leaving}
          balances={view.split.balances}
          saving={saving}
          onClose={() => setLeaving(null)}
          onLeave={() => void leave(leaving.id)}
          onSettleAndLeave={() => void settleAndLeave(leaving.id)}
        />
      ) : null}

      {settling && view?.split ? (
        <SettleDialog
          presence={settling}
          balances={view.split.balances}
          saving={saving}
          onClose={() => setSettling(null)}
          onConfirm={() => void settle(settling.id)}
        />
      ) : null}

      <Dialog open={pricing !== null} onOpenChange={(open) => !open && setPricing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pricing ? copy.group.unitPriceFor(pricing.itemName) : copy.group.setUnitPrice}</DialogTitle>
            <DialogDescription>{copy.prices.addHelp}</DialogDescription>
          </DialogHeader>
          <CoinFields idPrefix="loot-unit-price" value={priceParts} onChange={setPriceParts} disabled={saving} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPricing(null)}>
              {copy.common.cancel}
            </Button>
            <Button type="button" disabled={saving || !pricing} onClick={() => void saveUnitPrice()}>
              {copy.prices.savePrice}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={closeOpen}
        onOpenChange={(open) => {
          if (open) return;
          dismissClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.group.closeTitle}</DialogTitle>
            <DialogDescription>{copy.group.closeBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={dismissClose}>
              {copy.common.cancel}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void closeGroup()}>
              {copy.group.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={(open) => !open && setResetOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.group.resetTitle}</DialogTitle>
            <DialogDescription>{copy.group.resetBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
              {copy.common.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void reset()}>
              {copy.group.reset}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CollapsibleCardHeader
          headingId="group-pending-heading"
          panelId="group-pending-block"
          title={copy.home.pendingTitle}
          open={pendingOpen}
          onToggle={() => setPendingOpen((open) => !open)}
          showLabel={copy.group.collapseShow}
          hideLabel={copy.group.collapseHide}
          openDescription={copy.home.pendingBody}
          closedDescription={copy.group.pendingCollapsedSummary(pending.length)}
        />
        {pendingOpen ? (
        <CardContent id="group-pending-block" className="grid gap-3">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.home.pendingEmpty}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={dismissingAll || dismissingId != null}
                  onClick={() => void dismissAllPending()}
                >
                  {copy.home.pendingDismissAll}
                </Button>
              </div>
              <ul className="grid gap-3">
                {pending.map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 grid gap-1">
                      <p className="font-medium leading-snug">
                        {item.itemName}{" "}
                        <span className="text-muted-foreground font-normal tabular-nums">
                          {copy.home.pendingQty(item.quantity)}
                        </span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                        {item.unitCopper == null || item.lineCopper == null ? (
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                            <UnknownPrice />
                            <span className="sr-only">{copy.home.pendingUnpriced}</span>
                          </span>
                        ) : (
                          <CoinPhrase
                            text={copy.home.pendingLineCalc(item.quantity)}
                            amounts={[item.unitCopper, item.lineCopper]}
                            omitZeros={[true, true]}
                          />
                        )}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={dismissingAll || dismissingId === item.id}
                      onClick={() => void dismissPending(item.id)}
                    >
                      {copy.home.pendingDismiss}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function SplitResult({
  split,
  lines,
  saving,
  onMode,
  onSettleEveryone,
}: {
  split: SplitComputation;
  lines: PotLine[];
  saving: boolean;
  onMode: (mode: SplitMode) => void;
  onSettleEveryone: () => void;
}) {
  const { copy } = useI18n();
  const [splitOpen, setSplitOpen] = useState(true);
  // AfterMount gates first paint, so reading localStorage in the initializer is hydration-safe.
  const [roundCopper, setRoundCopper] = useState(readStoredChatRoundStep);
  const [shareTab, setShareTab] = useState<"chat" | "split">("chat");
  const members = settlementMembers(split.balances);
  const transfers = split.mode === "value" ? split.transfers : settleEveryone(members);
  const settled = split.mode === "value" ? split.settled : [];
  const everyoneEven = members.every((row) => row.balanceCopper === 0);
  // Item loot only — corpse coins are already split in-game and must not feed /split or primary totals.
  const { lootCopper } = potSessionTotals(lines);
  const gameSplitCommand = splitCommand(lootCopper);
  // Content signature — avoid resetting copy feedback when `transfers` is a new array with the same tips.
  const chatAnnounceKey = transfers
    .map((transfer) => `${transfer.fromPresenceId}>${transfer.toPresenceId}:${transfer.copper}`)
    .join("|");
  const chatMessages = useMemo(
    () => buildSettlementChatMessages(transfers, { roundCopper }),
    // transfers read inside; key is the stable dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chatAnnounceKey captures tip content
    [chatAnnounceKey, roundCopper],
  );
  const [chatPart, setChatPart] = useState(0);
  const [announceKeySeen, setAnnounceKeySeen] = useState(`${chatAnnounceKey}|${roundCopper}`);
  const [chatFeedback, setChatFeedback] = useState<string | null>(null);
  const [feedbackOpacity, setFeedbackOpacity] = useState(1);
  const [splitCopied, setSplitCopied] = useState(false);
  const feedbackFadeTimer = useRef<number | null>(null);
  const feedbackRaf = useRef<number | null>(null);
  const ensureValueMode = useEffectEvent(() => {
    onMode("value");
  });

  function applyRoundStep(step: number) {
    const next = normalizeChatRoundStep(step);
    setRoundCopper(next);
    writeStoredChatRoundStep(next);
  }

  /** Fully readable, then fade-out. */
  const COPY_FEEDBACK_HOLD_MS = 3200;
  const COPY_FEEDBACK_FADE_MS = 700;

  function clearCopyFeedbackTimers() {
    if (feedbackFadeTimer.current != null) window.clearTimeout(feedbackFadeTimer.current);
    if (feedbackRaf.current != null) window.cancelAnimationFrame(feedbackRaf.current);
    feedbackFadeTimer.current = null;
    feedbackRaf.current = null;
  }

  function clearCopyFeedback() {
    clearCopyFeedbackTimers();
    setChatFeedback(null);
    setFeedbackOpacity(1);
    setSplitCopied(false);
  }

  // Reset pager + copy toast when tip list or rounding changes (adjust state during render).
  const announceStateKey = `${chatAnnounceKey}|${roundCopper}`;
  if (announceKeySeen !== announceStateKey) {
    setAnnounceKeySeen(announceStateKey);
    setChatPart(0);
    setChatFeedback(null);
    setFeedbackOpacity(1);
    setSplitCopied(false);
  }

  function showCopyFeedback(message: string, markSplitCopied = false) {
    clearCopyFeedbackTimers();
    setChatFeedback(message);
    setFeedbackOpacity(1);
    setSplitCopied(markSplitCopied);
    feedbackFadeTimer.current = window.setTimeout(() => {
      feedbackFadeTimer.current = null;
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / COPY_FEEDBACK_FADE_MS);
        setFeedbackOpacity(1 - progress);
        if (progress < 1) {
          feedbackRaf.current = window.requestAnimationFrame(tick);
          return;
        }
        feedbackRaf.current = null;
        clearCopyFeedback();
      };
      feedbackRaf.current = window.requestAnimationFrame(tick);
    }, COPY_FEEDBACK_HOLD_MS);
  }

  useEffect(() => {
    if (split.mode === "items") ensureValueMode();
  }, [split.mode]);

  useEffect(() => {
    clearCopyFeedbackTimers();
    return () => clearCopyFeedbackTimers();
  }, [chatAnnounceKey, roundCopper]);

  async function copyChatAnnounce() {
    if (chatMessages.length === 0) return;
    const index = chatPart % chatMessages.length;
    const text = chatMessages[index] ?? "";
    try {
      await navigator.clipboard.writeText(text);
      const next = index + 1;
      setChatPart(next >= chatMessages.length ? 0 : next);
      showCopyFeedback(
        chatMessages.length > 1
          ? copy.group.copyChatAnnounceNext(index + 1, chatMessages.length)
          : copy.group.copyChatAnnounceDone,
      );
    } catch {
      showCopyFeedback(copy.group.copyFailed);
    }
  }

  async function copyGameSplitCommand() {
    try {
      await navigator.clipboard.writeText(gameSplitCommand);
      showCopyFeedback(copy.group.copySplitCommandDone, true);
    } catch {
      showCopyFeedback(copy.group.copyFailed);
    }
  }

  return (
    <Card>
      <CollapsibleCardHeader
        headingId="group-split-heading"
        panelId="group-split-block"
        title={copy.group.valueSplit}
        open={splitOpen}
        onToggle={() => setSplitOpen((open) => !open)}
        showLabel={copy.group.collapseShow}
        hideLabel={copy.group.collapseHide}
        openDescription={
          <>
            {copy.group.valueSplitHelp} · {copy.group.history(split.headcount)}
          </>
        }
        closedDescription={
          <CoinPhrase
            text={copy.group.valueSplitCollapsedSummary(COIN_SLOT, transfers.length)}
            amounts={[lootCopper]}
          />
        }
      />
      {splitOpen ? (
      <CardContent id="group-split-block" className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-[#6e5338]/55 bg-[#f7f3ea] px-3 py-2.5">
          <p className="font-heading text-sm font-medium text-foreground">{copy.group.lootValueTotal}</p>
          <CoinAmount copper={lootCopper} className="text-xl font-semibold text-foreground" />
        </div>

        <div className="grid gap-2 rounded-sm border-2 border-[#6e5338]/70 bg-[#efe6d6]/50 p-3">
          <div className="grid gap-0.5">
            <h4 className="font-heading text-base font-medium">{copy.group.payWhomTitle}</h4>
            <p className="text-sm text-muted-foreground">{copy.group.payWhomHelp}</p>
          </div>
          {settled.length > 0 ? (
            <div className="grid gap-1 border-b border-border/70 pb-2 text-sm">
              <p className="font-heading text-sm font-medium">{copy.group.alreadyPaid}</p>
              {settled.map((transfer) => (
                <p key={`${transfer.fromPresenceId}-${transfer.toPresenceId}-${transfer.copper}`}>
                  <CoinPhrase text={copy.group.paid(transfer.from, COIN_SLOT, transfer.to)} amounts={[transfer.copper]} />
                </p>
              ))}
            </div>
          ) : null}
          {transfers.length > 0 ? (
            <ul className="grid gap-2">
              {transfers.map((transfer) => (
                <li
                  key={`${transfer.fromPresenceId}-${transfer.toPresenceId}-${transfer.copper}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-[#6e5338]/35 bg-card px-3 py-2 text-base font-medium"
                >
                  <CoinPhrase text={copy.group.pays(transfer.from, COIN_SLOT, transfer.to)} amounts={[transfer.copper]} />
                </li>
              ))}
            </ul>
          ) : everyoneEven ? (
            <p className="text-sm text-muted-foreground">{copy.group.nothingToPay}</p>
          ) : null}

          <div className="grid gap-3 border-t border-[#6e5338]/40 pt-3">
            <div className="grid gap-2">
              <div role="tablist" aria-label={copy.group.shareTitle} className="inline-flex w-fit rounded-sm border border-[#6e5338]/55 bg-card p-0.5">
                {(["chat", "split"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={shareTab === tab}
                    onClick={() => setShareTab(tab)}
                    className={cn(
                      "rounded-[2px] px-3 py-1 font-heading text-sm transition-colors",
                      shareTab === tab ? "bg-[#6e5338] text-[#f7f3ea]" : "text-muted-foreground hover:bg-[#efe6d6]",
                    )}
                  >
                    {tab === "chat" ? copy.group.shareTabChat : copy.group.shareTabSplit}
                  </button>
                ))}
              </div>
              {shareTab === "chat" ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{copy.group.chatRoundLabel}</span>
                  <ChatRoundPicker
                    value={roundCopper}
                    onChange={applyRoundStep}
                    label={copy.group.chatRoundLabel}
                    customLabel={copy.group.chatRoundCustom}
                    customPlaceholder={copy.group.chatRoundCustomPlaceholder}
                    customApply={copy.group.chatRoundCustomApply}
                  />
                </div>
              ) : null}
              <p className="min-h-16 rounded-sm border border-[#6e5338]/35 bg-card px-3 py-2.5 font-mono text-sm leading-relaxed break-words text-foreground">
                {shareTab === "chat" ? (chatMessages[chatPart % chatMessages.length] ?? "") : gameSplitCommand}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {shareTab === "chat"
                    ? chatMessages.length > 1
                      ? `${copy.group.chatAnnouncePart((chatPart % chatMessages.length) + 1, chatMessages.length)} · ${copy.group.chatRoundHelp}`
                      : copy.group.chatRoundHelp
                    : copy.group.splitCommandHelp}
                </span>
                <Button
                  type="button"
                  disabled={shareTab === "chat" && chatMessages.length === 0}
                  onClick={() => void (shareTab === "chat" ? copyChatAnnounce() : copyGameSplitCommand())}
                >
                  {shareTab === "chat"
                    ? copy.group.copyChatAnnounce
                    : splitCopied
                      ? copy.common.copied
                      : copy.group.copySplitCommand}
                </Button>
              </div>
            </div>

            {chatFeedback ? (
              <p className="text-sm text-muted-foreground" style={{ opacity: feedbackOpacity }}>
                {chatFeedback}
              </p>
            ) : null}

            {transfers.length > 0 ? (
              <div className="border-t border-[#6e5338]/40 pt-3">
                <Button type="button" disabled={saving || split.mode !== "value"} onClick={onSettleEveryone}>
                  {copy.group.settleEveryone}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <h4 className="font-heading text-sm font-medium">{copy.group.eachHolds}</h4>
          <ul className="grid gap-3 text-sm md:grid-cols-2 md:gap-x-6">
            {members.map((row) => (
              <li key={row.key} className="grid gap-1 border-b border-border pb-3">
                <span className="font-heading text-base font-medium">{row.name}</span>
                <div className="grid gap-0.5 text-muted-foreground">
                  <HoldCoinRow label={copy.group.inHand} copper={row.lootedCopper} />
                  <HoldCoinRow label={copy.group.share} copper={row.shareCopper} />
                  <HoldBalanceRow balance={row.balanceCopper} copy={copy} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}

function CollapsibleCardHeader({
  headingId,
  panelId,
  title,
  open,
  onToggle,
  showLabel,
  hideLabel,
  openDescription,
  closedDescription,
}: {
  headingId: string;
  panelId: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  openDescription?: ReactNode;
  closedDescription?: ReactNode;
}) {
  const description = open ? openDescription : closedDescription;
  return (
    <CardHeader className="gap-2">
      <button
        type="button"
        id={headingId}
        className="flex w-full items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#7a4503]/40"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? hideLabel : showLabel}
        onClick={onToggle}
      >
        <CardTitle as="h3">{title}</CardTitle>
        <ChevronDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
          aria-hidden
        />
      </button>
      {description != null ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
  );
}

function draftRoster(view: PartyView, checkedIds: string[], guests: DraftGuest[]) {
  const fromMachine = view.people
    .filter((person) => checkedIds.includes(person.id))
    .map((person) => ({ key: person.id, name: person.name, personId: person.id, guestKey: null as string | null }));
  const fromNames = guests.map((guest) => ({
    key: guest.key,
    name: guest.name,
    personId: guest.personId ?? null,
    guestKey: guest.key,
  }));
  return [...fromMachine, ...fromNames];
}

function LeaveDialog({
  presence,
  balances,
  saving,
  onClose,
  onLeave,
  onSettleAndLeave,
}: {
  presence: PartyPresence;
  balances: BalanceRow[];
  saving: boolean;
  onClose: () => void;
  onLeave: () => void;
  onSettleAndLeave: () => void;
}) {
  const { copy } = useI18n();
  const row = balances.find((balance) => balance.key === presence.id);
  const owed = row?.balanceCopper ?? 0;
  const preview = settlePresence(balances, presence.id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.group.leaveTitle(presence.name)}</DialogTitle>
          <DialogDescription>
            {owed === 0 ? (
              copy.group.leaveEven
            ) : owed > 0 ? (
              <CoinPhrase text={copy.group.leaveOwes(COIN_SLOT)} amounts={[owed]} />
            ) : (
              <CoinPhrase text={copy.group.leaveOwed(COIN_SLOT)} amounts={[-owed]} />
            )}
          </DialogDescription>
        </DialogHeader>
        {preview.length > 0 ? (
          <div className="grid gap-1 text-sm">
            {preview.map((transfer) => (
              <p key={`${transfer.fromPresenceId}-${transfer.toPresenceId}`}>
                <CoinPhrase text={copy.group.pays(transfer.from, COIN_SLOT, transfer.to)} amounts={[transfer.copper]} />
              </p>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          {owed !== 0 ? (
            <Button type="button" disabled={saving} onClick={onSettleAndLeave}>
              {copy.group.settleAndLeave}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={saving} onClick={onLeave}>
            {owed === 0 ? copy.group.leave : copy.group.leaveWithout}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettleDialog({
  presence,
  balances,
  saving,
  onClose,
  onConfirm,
}: {
  presence: PartyPresence;
  balances: BalanceRow[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { copy } = useI18n();
  const row = balances.find((balance) => balance.key === presence.id);
  const balanceCopper = row?.balanceCopper ?? 0;
  const preview = settlePresence(balances, presence.id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.group.settleTitle(presence.name)}</DialogTitle>
          <DialogDescription>
            {balanceCopper > 0 ? (
              <span className="inline-flex flex-nowrap items-center gap-1.5">
                <BanknoteArrowUp className="size-5 shrink-0" aria-hidden />
                <CoinPhrase text={copy.group.settleTheyOwe(COIN_SLOT)} amounts={[balanceCopper]} />
              </span>
            ) : balanceCopper < 0 ? (
              <span className="inline-flex flex-nowrap items-center gap-1.5">
                <BanknoteArrowDown className="size-5 shrink-0" aria-hidden />
                <CoinPhrase text={copy.group.settleGiveToThem(COIN_SLOT)} amounts={[-balanceCopper]} />
              </span>
            ) : (
              copy.group.settled
            )}
          </DialogDescription>
        </DialogHeader>
        {preview.length > 0 ? (
          <div className="grid gap-1 text-sm">
            {preview.map((transfer) => (
              <p key={`${transfer.fromPresenceId}-${transfer.toPresenceId}`}>
                <CoinPhrase text={copy.group.pays(transfer.from, COIN_SLOT, transfer.to)} amounts={[transfer.copper]} />
              </p>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          {balanceCopper !== 0 ? (
            <Button type="button" disabled={saving} onClick={onConfirm}>
              {copy.group.confirmSettle}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quick-add chips under the member name field (draft + open group). */
function RecentPlayersBesideAdd({
  players,
  addingKey,
  saving,
  copy,
  onAdd,
  onDismiss,
}: {
  players: RecentPlayer[];
  addingKey: string | null;
  saving: boolean;
  copy: Copy;
  onAdd: (player: RecentPlayer) => void;
  onDismiss: (player: RecentPlayer) => void;
}) {
  if (players.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <p className="text-sm text-muted-foreground">{copy.home.playersTitle}</p>
      <ul className="flex flex-wrap gap-2">
        {players.map((player) => {
          const key = playerKey(player);
          const busy = addingKey === key || saving;
          return (
            <li key={key} className="group/recent relative isolate">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="pr-5"
                onClick={() => onAdd(player)}
              >
                {player.name}
              </Button>
              <button
                type="button"
                disabled={busy}
                className="absolute top-0 right-0 z-10 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/recent:opacity-100 group-focus-within/recent:opacity-100 focus-visible:opacity-100 hover:text-foreground disabled:pointer-events-none"
                aria-label={copy.home.playersDismiss(player.name)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDismiss(player);
                }}
              >
                <X className="size-2.5" strokeWidth={2} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Label left, fixed coin strip right — icons share columns across every hold line / character. */
function HoldCoinRow({ label, copper }: { label: string; copper: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_12.5rem] items-center gap-x-2">
      <span className="min-w-0 truncate">{label}</span>
      <CoinAmount copper={copper} aligned className="justify-self-end" />
    </div>
  );
}

function HoldBalanceRow({ balance, copy }: { balance: number; copy: Copy }) {
  if (balance === 0) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_12.5rem] items-center gap-x-2">
        <span className="font-medium text-muted-foreground">{copy.group.settled}</span>
        <CoinAmount copper={0} aligned className="justify-self-end" />
      </div>
    );
  }

  const owe = balance > 0;
  const Icon = owe ? BanknoteArrowUp : BanknoteArrowDown;
  const label = owe ? copy.group.owes("").trimEnd() : copy.group.receives("").trimEnd();
  const copper = Math.abs(balance);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_12.5rem] items-center gap-x-2 text-base font-medium",
        owe ? "text-destructive" : "text-[#2f5d3a]",
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <CoinAmount copper={copper} aligned className="justify-self-end text-base font-semibold" />
    </div>
  );
}

function splitCommand(copper: number): string {
  const parts = copperToCoins(copper);
  return `/split ${parts.platinum} ${parts.gold} ${parts.silver} ${parts.copper}`;
}

function lootLineTotalCopper(line: PotLine): number | null {
  if (line.unitCopper == null) return null;
  if (isCorpseCoins(line.itemName)) return line.unitCopper;
  return line.quantity * line.unitCopper;
}

function lootPriceLabel(line: PotLine, copy: Copy, coins: (amount: number) => string): string {
  if (line.unitCopper == null) return copy.common.unknownPrice;
  const total = lootLineTotalCopper(line) ?? line.unitCopper;
  if (line.quantity > 1 && !isCorpseCoins(line.itemName)) {
    return `${coins(total)} (${coins(line.unitCopper)} ${copy.prices.each})`;
  }
  return coins(line.unitCopper);
}

/** Names on the All tab, with each holder's quantity when the row is stacked. */
function LootHolderNames({ line }: { line: StackedAcrossPeopleLine | PotLine }) {
  const holders: LootHolderShare[] =
    "holders" in line && Array.isArray(line.holders) && line.holders.length > 0
      ? line.holders
      : [
          {
            personId: line.personId,
            personName: line.personName,
            quantity: line.quantity,
            copper: lootLineTotalCopper(line) ?? 0,
          },
        ];
  const showQty = holders.length > 1 && !isCorpseCoins(line.itemName);
  return (
    <>
      {holders.map((holder, index) => (
        <span key={holder.personId}>
          {index > 0 ? ", " : null}
          {holder.personName}
          {showQty ? <span className="tabular-nums"> ×{holder.quantity}</span> : null}
        </span>
      ))}
    </>
  );
}

function LootLinePriceDisplay({ line }: { line: PotLine }) {
  const { copy } = useI18n();
  if (line.unitCopper == null) return <UnknownPrice />;
  const total = lootLineTotalCopper(line) ?? line.unitCopper;
  if (line.quantity > 1 && !isCorpseCoins(line.itemName)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <CoinAmount copper={total} />
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>(</span>
          <CoinAmount copper={line.unitCopper} omitZeros />
          <span>{copy.prices.each})</span>
        </span>
      </span>
    );
  }
  return <CoinAmount copper={isCorpseCoins(line.itemName) ? total : line.unitCopper} />;
}

function isCorpseCoins(itemName: string): boolean {
  return itemKey(itemName) === itemKey(COIN_LOOT_ITEM_NAME);
}

function lootLineLabel(itemName: string, copy: Copy): string {
  return isCorpseCoins(itemName) ? copy.common.corpseCoins : itemName;
}
