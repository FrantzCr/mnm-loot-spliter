# Next release plan (post-0.1.4)

**Status:** ready for desktop QA, then release  
**Target:** **`0.2.0`** (schema 7 → 12, new Group layout, in-game party follow-up). Release with `npm run release -- 0.2.0 --notes "…"` once QA passes (the script builds, commits, tags, pushes and publishes).  
**Owner notes (Frantz, 2026-10-27):** agent decides UI; pack max in one ship; resume from this file if context drops.

## Locked decisions

1. **Recap / totals UI** — Agent chooses best UI. Rule: corpse coins (`Coins already split`) must **not** enter player/session totals used for fair share, `/split`, or the main “worth” figure. Coins may stay as a small optional footnote only if useful; default = hide from primary numbers.
2. **Reset pot** — Keeps roster + group name. Loot from the cleared session must be **invisible in the group UI** and **excluded from all split math** (not merely collapsed). Implementation: `session_epoch` (or equivalent) on the party; loot tagged with epoch; Reset bumps epoch so old lines drop out of queries. Do **not** delete ledger history globally.
3. **Close group** — Not a soft “pause”. Closing **archives** the group: window/view stays available with **name, loot snapshot, proposed splits** (read-only). User can **open another active group** alongside archived ones. Only the **active** group receives new `group_id` attachments.
4. **Chat rounding** — Default **1 silver**. User can pick **any step** (presets 1c/5c/10c/1s/5s/1g + free input like `25c`, `2s`, `1g 5s`). Same picker in Options and on the Share card (localStorage `mnm-chat-round-copper`).

## Scope checklist

### A — Correctness & desktop hardens

| ID | Item | Status |
|----|------|--------|
| A1 | `/split` uses **item loot copper only** (`lootCopper`), never corpse coins | done |
| A2 | Primary totals / player recap cards use items only; coins out of main calc/display | done |
| A3 | After **Record everyone's settlements**, hide unpriced-at-0 / unpriced session block from Overview | done |
| A4 | **Single-instance** Tauri (2nd launch focuses existing window) | done |
| A5 | Blank Options/Prices: prepare smoke for `/options`+`/prices`+chunk existence; client recovery if chunk load fails | done |

### B — Share UX & reset

| ID | Item | Status |
|----|------|--------|
| B1 | Share card: tabs Group chat \| `/split`, big preview, one Copy, part 1/N | done |
| B2 | Rounding picker (presets + any custom step, default 1s) on Share card + Options | done |
| B3 | **Reset pot** (epoch bump; loot invisible + out of math; roster kept) | done (manual QA on real data pending) |

### C — Information architecture

| ID | Item | Status |
|----|------|--------|
| C1 | Group tabs: **Overview** \| **Loot** \| **To sell** (Waiting to sell out of Overview) | done |
| C2 | Unpriced list lives under Loot (or Prices), not sticky on Overview after settle | done |

### D — Multi-group + naming

| ID | Item | Status |
|----|------|--------|
| D1 | `parties.name` (user-editable) | done |
| D2 | Statuses: `active` \| `closed` (archived view). One `active` max. Closed keeps loot + last split proposal readable | done |
| D3 | “New group” while another is closed/archived; switcher to reopen archived views | done |

### E — Group visual refonte

| ID | Item | Status |
|----|------|--------|
| E1 | Left rail: members, horizontal bar = % vs fair-share / total items | done |
| E2 | Clear +/− (owes / owed) coloring and amounts | done |
| E3 | Horizontal hold-vs-share diagram | done |
| E4 | Larger player recap cards | done |

## Implementation notes (chosen approaches)

### Coins out of calc
- Keep ingesting act_14 for audit if useful later, but **Overview math** and `/split` use `lootCopper` / non-coin lines only.
- `potSessionTotals` already splits `lootCopper` vs `splitCoinCopper` — stop summing them into primary UI and `splitCommand`.

### Reset pot
- Add `parties.session_epoch INTEGER NOT NULL DEFAULT 0` (or `pot_generation`).
- Loot rows store `session_epoch` at attach time (or party stores epoch and queries `l.session_epoch = p.session_epoch`).
- Reset: `UPDATE parties SET session_epoch = session_epoch + 1`, clear `party_settlements` for current epoch (or all for party), do not destroy presence rows.

### Archived close + new group
- `closeParty`: set `status = 'closed'`, keep `group_id` on loot, persist last mode + allow reading split from closed party id.
- UI: group switcher (active + closed). Active receives scans; closed is read-only detail.
- `startParty`: requires no other `active` (closed OK).

### Single-instance
- Prefer official Tauri 2 single-instance plugin; on duplicate launch, focus `main`.

### Blank pages
- Extend `prepare-desktop.mjs` smoke: fetch `/`, `/group`, `/prices`, `/options` and assert every `/_next/static/chunks/*` ref exists on disk.
- Optional: client error boundary → hard navigation on ChunkLoadError.

## Progress log

- **2026-10-27** — Plan locked with Frantz decisions; file created. Implementation starting A→E in one release track.
- **2026-10-27** — A1/A2: `group-screen` known worth, tab labels, split header, and `/split` use `lootCopper` only; removed coins-already-split from primary split totals UI.
- **2026-10-27** — A3: hide Overview unpriced block when value split is fully settled.
- **2026-10-27** — A4: `tauri-plugin-single-instance` focuses existing `main` window on 2nd launch.
- **2026-10-27** — A5 (partial): prepare-desktop smoke now checks `/group`, `/prices`, `/options` chunk files on disk.
- **2026-10-27** — A5 done: `lib/chunk-recovery.ts` + `app/error.tsx` / new `app/global-error.tsx` hard-reload once per path on ChunkLoadError (sessionStorage guard), then fall back to error UI.
- **2026-10-27** — B1/B2: Share block is now tabs (Group chat \| /split) with one preview + one Copy; `components/chat-round-toggle.tsx` (`ChatRoundPicker`) used on Share card and in Options. Rounding = any step (Frantz: "toute valeur").
- **2026-10-27** — B3: schema 8 — `parties.session_epoch`, `parties.pot_started_at`, `loot_entries.group_epoch`, `party_settlements.session_epoch`. `resetPot` replaces `resetParty` (DELETE /api/group): bumps epoch, clears settled_at, keeps presences. Loot looted before `pot_started_at` but read late lands in the previous (hidden) epoch. Close→resale only enqueues current-epoch loot. Test: `lib/reset-pot.test.ts`.
- **2026-10-27** — A+B committed (`d66fcf4`).
- **2026-10-27** — C1/C2: page-level tabs in `group-screen` (Overview = roster + split; Loot = pot with unpriced list always on top; To sell = pending resale). Tab badges: unpriced count on Loot, pending count on To sell. Overview shows a one-line unpriced hint (with a jump to Loot) only while tips are still open; the duplicate unpriced line in the members summary was removed.
- **2026-10-27** — C committed (`46f6e1e`).
- **2026-10-27** — D1–D3: schema 9 — `parties.name` (≤60 chars, null = "Group of <date>" label) and `parties.closed_at` (backfilled from `updated_at` for old closed rows). Status values stay `open` | `closed` in DB ("active" in UI). `readParty(db, partyId?)` reads archives; `PartyView.parties` lists all groups for the switcher; `renameParty` + `PATCH /api/group {id, name}`; `GET /api/group?id=`. UI: `components/group-switcher.tsx` (`GroupBar`: name + inline rename + "Show" select of active/closed) and `ArchivedGroup` in `group-screen` (read-only split via `SplitResult readOnly`, stacked loot). Mutations still only hit the open party. Test: `lib/multi-group.test.ts`.
- **Not done in D:** naming a group at start (start form has no name field; rename right after works).
- **2026-10-27** — D committed (`2b49ff9`).
- **2026-10-27** — E1–E4: `components/split-visuals.tsx` — `MemberRail` (Overview left rail ≥lg, sticky; stacks on top below lg): per member % of item worth vs fair %, `HoldShareBar` and signed `BalanceChip`. `HoldShareBar`: solid = held up to share, red hatched = held above share (to give), dashed green = missing to share (to receive), tick = fair share. "What each person holds" now uses `PlayerRecapCard` (border tinted by balance, shared bar scale across players). Archived groups get the cards too (via `SplitResult`). Old `HoldCoinRow`/`HoldBalanceRow` removed. Checked at 1280, 800 and 375 px (no horizontal scroll).
- **Next:** full QA pass on the packaged desktop build (`npm run desktop:prepare` + `tauri build`), then version bump (0.2.0: schema 7→9, new IA) and release.
- **2026-10-27** — Post-E polish (uncommitted at time of writing): Members panel now holds all member management (expandable rows with Settle/Leave, add member, recent players, Close/Reset); "What each person holds" removed; held item value shown under each name; shared coin columns (`coinColumnsFor`). **Keep** the Sharing-the-loot totals strip (Item loot (priced) / Coins already split in-game / Session totals) — Frantz wants it; coins stay display-only, never in split math.
- **2026-10-27** — In-game party follow-up (semi-automatic): Social ledgers carry party events (act_31 PartyCreate, act_32 PartyJoin with f02 = base64 leader, act_33 PartyDisband, act_34 PartyLeave, act_01 roster line with d21 level). Parsed in `ledger-parse` → `game_party_events` (schema 12; social files re-read once via setting `party_events_backfill_v2`). `lib/game-party.ts` replays per observer → live roster + departures; `gamePartyProposals` → `PartyView.gameParty` {arrivals, departures}. UI `GamePartyPrompt` in Members panel: add arrivals (one / all) at in-game join time, settle & leave / leave at in-game leave time, "party ended → close group"; dismissals per viewer in localStorage. Presence POST and leave POST accept `at` (`eventTime` guard). Autocomplete: live game party → players seen this week → past groups. Tests: `lib/game-party.test.ts`. Only the "party ended" prompt was seen on real data; arrivals / single departures are covered by unit tests only.
- **2026-10-27** — Release prep: removed temp page `app/dev-rail-check`, dead `BalanceAmount`, 56 unused copy keys (×3 locales); `tsconfig` excludes `src-tauri` (stale build copies broke `tsc`); `shell.tsx` lint error fixed (first watch-path read deferred a tick); `GroupBar` tolerates a missing parties list; not-found link button sets `nativeButton={false}`. Lint, typecheck and 88 tests clean.

## Draft release notes (0.2.0)

**Group page, redesigned**
- Members panel on the left (always visible): who gives / who receives as a bar centred on the fair share, items held under each name, = to settle and × to leave. Click a member to see their loot.
- Two tabs on the right: **Split** (who pays whom, group chat announce, /split) and **Loot** (unpriced items first, sort by newest or value, waiting-to-sell list).
- Named groups: rename with the pencil; closed groups stay readable as archives (Show menu).
- Reset pot: start a fresh split with the same members.

**In-game party follow-up (semi-automatic)**
- Reads party joins / leaves from the game's Social ledger: offers to add new party members at their real join time, and to settle / leave members at their real leave time. Nothing changes without a click.
- Add-member autocomplete suggests the live in-game party first, then players met this week.

**Sharing**
- Group chat rounding set right in the announce ("rounded to 10c ▾"); new steps 50c, 2s, 10s, 50s, any custom step; the announce says how it was rounded.
- /split and fair shares use item value only (corpse coins stay out, shown as session info).

**Fixes**
- Packaged app: second launch focuses the open window; a failed page chunk reloads once instead of a blank page.
- Coins centred inside buttons; totals labels stay on one line in every language.

**Upgrade note:** the local database migrates automatically (schema 12) and re-reads Social ledgers once to import party history.
