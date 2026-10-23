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

---

## Download the installer (easiest)

Pre-built Windows setups are published on **this same repository**, under
[**Releases**](https://github.com/FrantzCr/loot-spliter/releases):

1. Open the latest release.
2. Download the `.exe` (for example `MnM Loot Splitter_0.1.0_x64-setup.exe`).
3. Run it and install.

No Node, Rust, or Visual Studio needed — just install and play.

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

### 3. Build the installer

```powershell
npm run tauri:build
```

That one command prepares the Next app, bundles Node, and builds the NSIS setup.
The first run can take a while (downloads a portable Node zip into `desktop/.cache/`).

### 4. Find the setup file

```text
src-tauri\target\release\bundle\nsis\
```

Look for something like:

```text
MnM Loot Splitter_0.1.0_x64-setup.exe
```

Install that `.exe`. End users of the installed app do **not** need Node.

### After install

- App data (SQLite): `%LOCALAPPDATA%\loot-spliter\registre.sqlite`
- Packaged app port: **14721** (local only)
- Closing the window stops the embedded server

---

## Using the app

1. Open **Options** and point at the game folder, or straight at a character’s
   `Ledger` folder, then choose **Use this folder**.
2. Keep MnM Loot Splitter open while you play — public docs say the client
   removes Ledger files when the game closes; lines already copied into SQLite
   remain.
3. Use **Group** to start a party, track who holds what at known resale value,
   and see who should pay whom to even out (**value split**).
4. Maintain a **resale price book** (manual prices, your own vendor sales, or
   **Fill gaps from MnMdb** on the prices page — community vendor observations
   from [mnm-db.com](https://mnm-db.com) / mnm-tools; never overwrites local prices).
   Export / import JSON (or another copy’s price book) when useful.
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

## Features

- **Ledger watch** — scan / watch the client folder; copy loot into local SQLite
- **Per-character loot** — loot tied to the character named in the journal
- **Group value split** — fair share from known resale prices; settle who pays whom
- **Price book** — unit prices you enter; apply to past and future loot of that item
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

SQLite path is the same in browser/dev and packaged builds:
`%LOCALAPPDATA%\loot-spliter\`. Nothing is prefilled.

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
