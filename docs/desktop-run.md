# Standalone desktop app (Tauri + Next)

**MnM Loot Splitter** is a normal Windows window (WebView2) that starts the local register. **No overlay** — against game rules / out of scope. The exe bundles Node + the Next server (`output: 'standalone'`), so end users do not need Node preinstalled.

## Prérequis pour *construire* l’installateur

- Node.js LTS (sur la machine de build)
- Rust (`rustc`, `cargo`)
- Visual Studio 2022 avec **Desktop development with C++**
- WebView2 Runtime (présent sur Windows 10/11 récents)

## Dev

```powershell
npm install
npm run tauri:dev
```

`wait:dev` démarre `npm run dev` si le port **4721** est libre. La fenêtre pointe sur `http://127.0.0.1:4721`.

## Installateur autonome (NSIS)

```powershell
npm run tauri:build
```

Cela exécute `desktop:prepare` (build Next standalone + copie des assets + Node portable win-x64 + scrub des chemins absolus de la machine de build), puis compile Tauri.

`prepare-desktop` retire aussi les `.map` / SQLite locaux du bundle et **échoue** s’il reste des traces `Users\<compte>` ou le chemin du projet — l’installateur NSIS ne doit pas embarquer ton profil Windows.

Sortie typique : `src-tauri/target/release/bundle/nsis/`.

Au lancement, l’exe démarre `resources/register/node.exe server.js` (`PORT=14721`, `HOSTNAME=127.0.0.1`) puis ouvre la fenêtre sur le registre. Le port **14721** est volontairement distinct de **4721** (`npm run dev`) pour ne pas afficher l’indicateur Next « N » ni se brancher sur un serveur de développement déjà ouvert. Fermer la fenêtre arrête le sidecar.

SQLite reste dans `%LOCALAPPDATA%\loot-spliter\registre.sqlite` (inchangé).

`npm run dev` / `npm start` écoutent aussi sur **127.0.0.1** uniquement (API sans auth — ne pas binder `0.0.0.0`).

## Limites

- Premier `tauri:build` télécharge le zip Node officiel (cache sous `desktop/.cache/`).
- Sur Windows, `output: 'standalone'` peut exiger le mode développeur / droits pour les symlinks ; sinon le runtime peut ne pas être relogeable — activer Developer Mode si besoin.
