# MnM Loot Splitter

A **local loot and group-split tool** for the MMO **Monsters & Memories**.
It watches the Ledger JSON files the game client already writes to disk, copies
loot lines into a local SQLite database, tracks unit resale prices you enter,
and helps even out group value after a session.

UI languages: **English**, **French**, and **Spanish** (Language menu).

> Independent tool — not made by or affiliated with the developers of
> Monsters & Memories (Niche Worlds Cult). It does not inject into the client,
> read process memory, or capture network traffic. It only opens Ledger files
> that are already on disk.

### In a minute

1. Download the setup `.exe` from the latest [Release](https://github.com/FrantzCr/mnm-loot-spliter/releases) and install it.
2. Open **Options**, point it at the game folder, and choose **Use this folder**.
3. Open **Group**, add the people you play with, and loot as usual. At the end, read
   **Who gives what to whom** and paste the split into chat.

### Contents

- [Download the installer](#download-the-installer-easiest)
- [Using the app](#using-the-app)
- [How the split works](#how-the-split-works)
- [Something looks wrong](#something-looks-wrong)
- [Features](#features)
- [Build the Windows installer yourself](#build-the-windows-installer-yourself)
- [For developers](#for-developers-run-from-source)
- [Data & privacy](#data--privacy)

---

## Download the installer (easiest)

Pre-built Windows setups are published on **this same repository**, under
[**Releases**](https://github.com/FrantzCr/mnm-loot-spliter/releases):

1. Open the latest release.
2. Download the `.exe` (for example `MnM_Loot_Splitter_<version>_x64-setup.exe`).
3. Run it and install (per-user, no admin required).

If **Windows SmartScreen** appears (“Windows protected your PC”), choose **More info**, then **Run anyway**. The installer is unsigned until a code-signing certificate is used.

No Node, Rust, or Visual Studio needed — just install and play.

Installed desktop builds can also check for updates from **Options → Version & updates**.

If there is no release yet, or you prefer to compile yourself, use the section
below.

---

## Build the Windows installer yourself

For contributors (or when you want a local build). You need the tools below once.

### 1. Install these once (Windows)

| Need | Why |
| --- | --- |
| [Node.js LTS](https://nodejs.org/) | Runs the app tooling |
| [Rust](https://rustup.rs/) | Compiles the Tauri desktop shell |
| Visual Studio 2022 with **Desktop development with C++** | Windows linker / MSVC |
| WebView2 | Already on most Windows 10/11 PCs |

If Next’s standalone build complains about symlinks, turn on **Windows Developer Mode**.

More detail: [docs/desktop-run.md](docs/desktop-run.md).

### 2. Get the code and install dependencies

In PowerShell, from the project folder:

```powershell
npm install
```

### 3. Build the installer (local only)

```powershell
npm run tauri:build
```

That prepares the Next app, bundles Node, and builds the NSIS setup.
The first run can take a while (downloads a portable Node zip into `desktop/.cache/`).

Installer output:

```text
src-tauri\target\release\bundle\nsis\MnM Loot Splitter_<version>_x64-setup.exe
```

### 4. Publish a GitHub Release (one command)

Working tree must be clean (commit your changes first). Then from the project folder:

```powershell
npm run release -- patch
```

Also accepted: `minor`, `major`, or an exact version (`0.1.1`).

What it does: bump version → `tauri:build` → commit → tag → push → `gh release create` with the setup `.exe`.

```powershell
npm run release -- patch --notes "Settlement UI previews and fair-share fixes."
npm run release -- 0.1.1 --skip-build
npm run release -- patch --dry-run
```

Needs `gh` authenticated (`gh auth login`). End users of the installed app do **not** need Node.

### After install

- App install folder (current user): `%LOCALAPPDATA%\MnM Loot Splitter\`
- App data (SQLite): `%LOCALAPPDATA%\mnm-loot-spliter\registre.sqlite`
- Sidecar logs (if the window fails to open): `%LOCALAPPDATA%\com.mnm-loot-spliter.register\logs\`
- Packaged app port: **14721** (local only)
- Closing the window stops the embedded server
- WebView2 is installed automatically by the setup if missing

---

## Using the app

1. Open **Options** and point at the game folder, or straight at a character’s
   `Ledger` folder, then choose **Use this folder**.
2. Keep MnM Loot Splitter open while you play — public docs say the client
   removes Ledger files when the game closes; lines already copied into SQLite
   remain.
3. Use **Group** to start a party, track who holds what at known resale value,
   and see who should pay whom to even out (**value split**).
4. Maintain a **resale price book** (manual prices, your own vendor sales,
   **Fill gaps from the shared price book** — see below — or **Fill gaps from MnMdb**
   on the prices page — community vendor observations from
   [mnm-db.com](https://mnm-db.com) / mnm-tools; neither ever overwrites local prices).
   Export / import JSON (or another copy’s price book) when useful.

### Shared price book

[`shared/price-book.json`](shared/price-book.json) is an export of the author’s own
price book (about 400 items), kept in this repository. On the **Resale prices** page,
**Fill gaps from the shared price book** downloads it from GitHub and:

- adds a price only for items you have **no price for yet** — your prices, and loot
  lines you edited by hand, are never changed;
- writes it straight to your book (nothing to approve under *needs a decision*);
- prices the loot you already have for those items right away.

The app always reads the latest version of the file, so it can be updated without a
new release. Anyone can also download it and use **Import** on the prices page.
5. After a group closes, **Waiting to sell** and **Recent players** help with
   leftover vendor stock and inviting people back.

Usual Windows client path:

```text
%USERPROFILE%\AppData\LocalLow\Niche Worlds Cult\Monsters and Memories
```

Then: server folder → character folder → `Ledger`. Relevant files:

- `Name_Character_YYYY-MM-DD.json` — character interactions (loot, vendor sales, …)
- `Name_Social_YYYY-MM-DD.json` — social log (can also mention loot)

Only `act_13` (“loot an item”) becomes a loot line. Vendor sales (`act_24`) are
recorded separately and do not enter the group pot.

---

## How the split works

The group page answers one question: *who should hand coin to whom so everyone ends
up with the same value?* No item changes hands — whoever looted something keeps it,
and the difference is evened out in coin.

**1. What each person holds.** Every loot line belongs to the character who looted
it, valued at its **resale price** from your price book. Items with no known price
are left out of the split (the totals tell you how many). Coin taken from corpses is
already shared by the game itself, so it only shows in the session totals.

**2. What each person should get.** Each item's value is divided between the members
who were **in the group when it was looted**. Someone who joined late gets nothing
from earlier drops; someone who left gets nothing from later ones. Leftover copper
from an uneven division goes to the first members of the list.

**3. The balance.** Balance = value held − fair share.

| In the Members list | Meaning |
| --- | --- |
| **+** (green), bar to the right | Holds more than their share: pays out |
| **−** (red), bar to the left | Holds less than their share: receives |
| **even** | Nothing to do |

**4. Who gives what to whom.** The biggest payer is matched with the biggest receiver,
for the smaller of the two amounts, and so on until everyone is even. This keeps the
number of trades low. A line like `Aby → Mezma: 10 copper` means Aby gives Mezma 10
copper.

Example, with a fair share of 10 each:

| | Holds | Share | Balance |
| --- | --- | --- | --- |
| Aby | 25 | 10 | +15 |
| Shorn | 12 | 10 | +2 |
| Foxman | 3 | 10 | −7 |
| Mezma | 0 | 10 | −10 |

→ `Aby → Mezma: 10`, `Aby → Foxman: 5`, `Shorn → Foxman: 2`.

**Settling as you go.** The **=** button on a member records their trades as done, so
they drop out of the remaining list. **Settle & leave** does that and marks them as
gone. Members who left and have nothing left to settle are hidden from the list (their
share still counts).

**Reset pot vs Close the group.** **Reset pot** keeps the same people but starts a new,
empty pot — handy between two camps or after paying everyone. Previous pots stay
readable from the **Show** menu, under *Previous pots*. **Close the group** ends it for
good; it moves to *Closed groups* in the same menu, read-only, and its unsold items go to
**Waiting to sell**.

**In-game party.** When the game's social log shows someone joining or leaving your
party, the group page offers to add them or mark them as gone. Nothing changes until
you click.

---

## Something looks wrong

| You see | Try this |
| --- | --- |
| No loot shows up | Check the folder in **Options** points at the game folder or a `Ledger` folder, and keep the app open while you play: the game deletes its Ledger files when it closes. |
| An item counts for nothing | It has no resale price yet. Set one on the prices page, or use **Fill gaps from the shared price book** or **Fill gaps from MnMdb**. The price applies to past loot too. |
| Someone's share looks wrong | Check when they joined and left (shown under their name). Loot only counts for people present at that moment. |
| A member is missing from the list | They left and have nothing to settle, so they are hidden; their share is still counted. |
| The pot from earlier is gone | It was reset. Pick it under *Previous pots* in the **Show** menu. |
| The desktop window doesn't open | Look at the logs in `%LOCALAPPDATA%\com.mnm-loot-spliter.register\logs\`. |

The split is only as good as the prices and the join / leave times — when in doubt,
check those first.

---

## Features

- **Ledger watch** — scan / watch the client folder; copy loot into local SQLite
- **Per-character loot** — loot tied to the character named in the journal
- **Group value split** — fair share from known resale prices; settle who pays whom
- **Join / leave times** — late arrivals and early leavers only share the loot of their time in the group
- **Reset pot & history** — start a fresh pot with the same people; past pots and closed groups stay readable
- **In-game party follow-up** — offers to add or remove members as the game's party changes
- **Price book** — unit prices you enter; apply to past and future loot of that item
- **Shared price book** — fill missing prices from the author’s price book on GitHub
- **Pending sell** — items from closed groups waiting for a vendor sale (or dismiss)
- **Recent players** — people from recently closed groups, for quick re-add
- **EN / FR / ES** — switch language in the app

Honest limits: prices are manual (no shipped price list); ground pickup, harvest,
and trades stay in the client files and are not treated as loot lines.

---

## For developers (run from source)

Dev server in the browser (loopback only, port **4721**):

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:4721**.

Desktop window pointed at that same server:

```powershell
npm run tauri:dev
```

| Script | Purpose |
| --- | --- |
| `npm test` | Ledger parse, split, and price-book checks |
| `npm run desktop:prepare` | Next standalone + desktop assets (used by the installer build) |
| `npm run tauri:build` | Full Windows installer (see section above) |
| `npm run release -- patch` | Bump, build, tag, push, and publish a GitHub Release |

SQLite path is the same in browser/dev and packaged builds:
`%LOCALAPPDATA%\mnm-loot-spliter\`. Nothing is prefilled.

**Refreshing the shared price book:** on the prices page, **Export** your price book,
replace [`shared/price-book.json`](shared/price-book.json) with it, then commit and
push to `main`. No release needed — the app fetches the file from `main`. (Keep it in
`shared/`: `data/` is git-ignored because the dev database can live there.)

---

## Data & privacy

Everything stays **on this machine**. MnM Loot Splitter reads Ledger JSON from
the path you choose and writes only to its local SQLite file. There is no cloud
sync and no account. Files under the game folder are read, never modified.

This is a **local-only** tool. The API has no authentication — the Next server
must stay on **loopback** (`127.0.0.1`). Do not bind it to `0.0.0.0`, do not
expose ports **4721** / **14721** on a network, and do not deploy this as a
shared or cloud service. Packaged builds already force `HOSTNAME=127.0.0.1`.

Author: [PandaCodes](https://github.com/FrantzCr) · License: [MIT](LICENSE).
