/**
 * After `next build`, assemble a self-contained register runtime for Tauri:
 * - Next standalone server + static/public assets
 * - Portable Node.exe (same major as this machine's Node)
 * - Strip build-machine absolute paths so the NSIS setup has no personal traces
 *
 * Output: src-tauri/resources/register/
 */
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const standalone = join(root, ".next", "standalone");
const outDir = join(root, "src-tauri", "resources", "register");
const cacheDir = join(root, "desktop", ".cache");

const version = process.versions.node;
const nodeDist = `node-v${version}-win-x64`;
const zipName = `${nodeDist}.zip`;
const zipUrl = `https://nodejs.org/dist/v${version}/${zipName}`;
const zipPath = join(cacheDir, zipName);
const extractedNode = join(cacheDir, nodeDist, "node.exe");

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".txt",
  ".html",
  ".htm",
  ".css",
  ".map",
  ".svg",
  ".xml",
  ".md",
]);

async function download(url, dest) {
  if (existsSync(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body, createWriteStream(dest));
}

function extractZip(zip, destDir) {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destDir}' -Force`],
    { stdio: "inherit" },
  );
}

/** Absolute path spellings that Next embeds in standalone manifests / server.js. */
function absolutePathSpellings(absolute) {
  const resolved = resolve(absolute);
  const forward = resolved.replaceAll("\\", "/");
  const back = forward.replaceAll("/", "\\");
  const spellings = new Set([resolved, forward, back]);
  // JSON / JS string escapes
  spellings.add(back.replaceAll("\\", "\\\\"));
  spellings.add(forward.replaceAll("\\", "\\\\"));
  // Lowercase drive letter variants (Windows)
  for (const value of [...spellings]) {
    if (/^[A-Za-z]:/.test(value)) {
      spellings.add(value[0].toLowerCase() + value.slice(1));
      spellings.add(value[0].toUpperCase() + value.slice(1));
    }
  }
  return [...spellings].sort((a, b) => b.length - a.length);
}

async function walkFiles(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        // Still scrub config JSON that may sit under traced node_modules copies — rare but cheap to walk names only for text scrub.
        await walkFiles(full, onFile);
        continue;
      }
      await walkFiles(full, onFile);
      continue;
    }
    if (entry.isFile()) await onFile(full);
  }
}

/** Repo trees that must never ship inside the packaged register runtime. */
const BUNDLE_EXCLUDE_DIRS = [
  "src-tauri",
  "desktop",
  "docs",
  "release-assets",
  "scripts",
  ".git",
  "agent-transcripts",
];

async function removeBundledJunk(dir) {
  for (const name of BUNDLE_EXCLUDE_DIRS) {
    const target = join(dir, name);
    if (existsSync(target)) {
      console.log(`Removing traced junk from register: ${name}`);
      await rm(target, { recursive: true, force: true });
    }
  }
}

async function removeLocalDataArtifacts(dir) {
  await walkFiles(dir, async (file) => {
    const name = file.toLowerCase();
    if (
      name.endsWith(".sqlite") ||
      name.endsWith(".sqlite-shm") ||
      name.endsWith(".sqlite-wal") ||
      name.endsWith(".map")
    ) {
      await unlink(file);
    }
  });
  const dataDir = join(dir, "data");
  if (existsSync(dataDir)) {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function shouldScrubFile(file) {
  const base = file.replaceAll("\\", "/").toLowerCase();
  if (base.endsWith("/server.js")) return true;
  if (base.endsWith("required-server-files.json")) return true;
  if (base.endsWith(".nft.json")) return true;
  // Next route manifests / build traces under .next (not node_modules).
  if (base.includes("/.next/") && !base.includes("/node_modules/") && TEXT_EXTENSIONS.has(extname(file).toLowerCase())) {
    return true;
  }
  if (base.endsWith("/package.json") && !base.includes("/node_modules/")) return true;
  return false;
}

async function scrubAbsolutePaths(dir, projectRoot) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const replacements = [];
  for (const spelling of absolutePathSpellings(projectRoot)) {
    replacements.push([spelling, "."]);
  }
  if (home) {
    for (const spelling of absolutePathSpellings(home)) {
      replacements.push([spelling, "%USERPROFILE%"]);
    }
  }

  let filesTouched = 0;
  await walkFiles(dir, async (file) => {
    if (!shouldScrubFile(file)) return;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return;
    }
    let next = text;
    for (const [from, to] of replacements) {
      if (!from || from.length < 3) continue;
      if (next.includes(from)) next = next.split(from).join(to);
    }
    if (next !== text) {
      await writeFile(file, next);
      filesTouched += 1;
    }
  });
  return filesTouched;
}

async function assertNoPersonalTraces(dir, projectRoot) {
  const needles = new Set(absolutePathSpellings(projectRoot));
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home) {
    // Username folder specifically (Windows Users\<name>)
    const match = home.match(/[\\/]Users[\\/]([^\\/]+)$/i);
    if (match?.[1]) {
      needles.add(`Users\\${match[1]}`);
      needles.add(`Users/${match[1]}`);
      needles.add(`Users\\\\${match[1]}`);
    }
  }

  const hits = [];
  await walkFiles(dir, async (file) => {
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !file.endsWith(".nft.json")) return;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return;
    }
    for (const needle of needles) {
      if (needle.length >= 4 && text.includes(needle)) {
        hits.push(`${file} ← contains ${needle}`);
        break;
      }
    }
  });

  if (hits.length > 0) {
    throw new Error(
      `Packaged register still contains build-machine paths (${hits.length} file(s)). First hits:\n` +
        hits.slice(0, 12).join("\n"),
    );
  }
}

async function main() {
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error("Missing .next/standalone/server.js — run `next build` with output: 'standalone' first.");
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  console.log("Copying Next standalone → resources/register");
  await cp(standalone, outDir, { recursive: true });

  const staticSrc = join(root, ".next", "static");
  if (existsSync(staticSrc)) {
    await mkdir(join(outDir, ".next"), { recursive: true });
    await cp(staticSrc, join(outDir, ".next", "static"), { recursive: true });
  }

  const publicSrc = join(root, "public");
  if (existsSync(publicSrc)) {
    await cp(publicSrc, join(outDir, "public"), { recursive: true });
  }

  if (!existsSync(extractedNode)) {
    await download(zipUrl, zipPath);
    extractZip(zipPath, cacheDir);
  }
  if (!existsSync(extractedNode)) {
    throw new Error(`node.exe not found after extract: ${extractedNode}`);
  }
  await cp(extractedNode, join(outDir, "node.exe"));

  console.log("Removing traced non-runtime trees from register bundle");
  await removeBundledJunk(outDir);

  console.log("Removing local SQLite / source maps from register bundle");
  await removeLocalDataArtifacts(outDir);

  console.log("Scrubbing build-machine absolute paths");
  const touched = await scrubAbsolutePaths(outDir, root);
  console.log(`Rewrote ${touched} file(s)`);

  await assertNoPersonalTraces(outDir, root);
  console.log("Personal-path check passed");

  console.log("Smoke-checking packaged register runtime");
  await assertRegisterReady(outDir);

  await writeFile(
    join(outDir, "RUNTIME.txt"),
    [
      "Bundled register runtime for MnM Loot Splitter (Tauri).",
      `Node ${version}`,
      `Built ${new Date().toISOString()}`,
      "Build paths scrubbed for redistribution.",
      "",
    ].join("\n"),
  );

  const pkg = JSON.parse(await readFile(join(outDir, "package.json"), "utf8"));
  const size = (await stat(join(outDir, "server.js"))).size;
  console.log(`Ready: ${outDir} (${pkg.name ?? "register"}, Node ${version}, server.js ${size} B)`);
}

/** Fail the desktop prepare if the register tree cannot serve HTTP. */
async function assertRegisterReady(dir) {
  const node = join(dir, "node.exe");
  const server = join(dir, "server.js");
  const nextServer = join(dir, ".next", "server");
  for (const required of [node, server, nextServer]) {
    if (!existsSync(required)) {
      throw new Error(`Register runtime incomplete — missing ${required}`);
    }
  }
  const nodeStat = await stat(node);
  if (nodeStat.size < 10_000_000) {
    throw new Error(`node.exe looks too small (${nodeStat.size} bytes)`);
  }

  const port = String(18000 + Math.floor(Math.random() * 1000));
  const child = spawn(node, ["server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let settled = false;
  const logs = { out: "", err: "" };
  child.stdout?.on("data", (chunk) => {
    logs.out += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs.err += chunk.toString();
  });

  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        throw new Error(
          `Register smoke process exited early (${child.exitCode}).\n${logs.err || logs.out}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
        if (response.ok) {
          settled = true;
          break;
        }
      } catch {
        // keep waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!settled) {
      throw new Error(`Register smoke did not answer on port ${port}.\n${logs.err || logs.out}`);
    }

    // Soft-nav fails hard if HTML references missing client chunks (white screen on /group|/prices|/options).
    const routes = ["/group", "/prices", "/options"];
    let chunkRefCount = 0;
    for (const route of routes) {
      const page = await fetch(`http://127.0.0.1:${port}${route}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!page.ok) {
        throw new Error(`Register smoke ${route} returned HTTP ${page.status}`);
      }
      const html = await page.text();
      const chunkRefs = [...html.matchAll(/\/_next\/static\/chunks\/[^"'\s>]+/g)].map((m) => m[0]);
      chunkRefCount += chunkRefs.length;
      const missing = [];
      for (const ref of new Set(chunkRefs)) {
        const name = ref.split("/").pop();
        if (!name) continue;
        if (!existsSync(join(dir, ".next", "static", "chunks", name))) {
          missing.push(name);
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `Register smoke ${route} references missing static chunks:\n  ${missing.join("\n  ")}`,
        );
      }
    }
    console.log(
      `Register smoke OK on :${port} (/, ${routes.join(", ")}, ${chunkRefCount} chunk refs)`,
    );
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(resolve, 2000);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
