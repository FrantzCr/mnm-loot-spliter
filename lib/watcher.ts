import { scanNow } from "./scan";

const globalWatcher = globalThis as unknown as { registreTimer?: NodeJS.Timeout; registreToken?: symbol };

const token = Symbol("registre-watcher");

export function ensureWatcher() {
  if (globalWatcher.registreToken === token && globalWatcher.registreTimer) return;
  if (globalWatcher.registreTimer) clearInterval(globalWatcher.registreTimer);
  globalWatcher.registreToken = token;
  globalWatcher.registreTimer = setInterval(() => {
    try {
      scanNow();
    } catch (error) {
      console.error("Lecture des journaux interrompue", error);
    }
  }, 3000);
  globalWatcher.registreTimer.unref?.();
  try {
    scanNow();
  } catch (error) {
    console.error("Première lecture des journaux interrompue", error);
  }
}
