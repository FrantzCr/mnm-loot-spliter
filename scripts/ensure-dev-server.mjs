/**
 * Used by `tauri dev`. If the Next server is already on 4721, exit.
 * Otherwise start `npm run dev` and wait until it answers.
 */
import { spawn } from "node:child_process";

const URL = "http://127.0.0.1:4721/";

async function isUp() {
  try {
    const response = await fetch(URL, { redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  }
}

if (await isUp()) {
  process.exit(0);
}

const child = spawn("npm", ["run", "dev"], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
  detached: true,
  windowsHide: true,
});
child.unref();

for (let attempt = 0; attempt < 90; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await isUp()) process.exit(0);
}

console.error("The register did not start on port 4721.");
process.exit(1);
