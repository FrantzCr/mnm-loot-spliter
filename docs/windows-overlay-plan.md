# Plan historique — overlay (abandonné)

**Décision (2026-10-22) :** pas d’overlay. Interdit / hors règles du jeu. L’objectif desktop est une **application Windows autonome** (fenêtre normale) : voir [`desktop-run.md`](./desktop-run.md).

Le reste de ce fichier est conservé comme recherche archivée (HDT, Untapped, Overwolf, Tauri) ; ne plus l’utiliser comme feuille de route.

---

## Contexte recherche (archivé)

Objectif initial : `.exe` + fenêtre topmost pendant le jeu, sans injection ni lecture mémoire. Techniques étudiées : HDT (`WS_EX_TRANSPARENT`), companions MTGA (Player.log), Overwolf, Tauri `alwaysOnTop` / click-through.

**Chemin retenu aujourd’hui :** Tauri 2 + Next `standalone` + Node embarqué → une seule fenêtre registre. Lecture Ledger fichiers uniquement, SQLite dans `%LOCALAPPDATA%`.
