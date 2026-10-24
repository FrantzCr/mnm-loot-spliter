/**
 * One-shot GitHub release: bump version → build installer → commit → tag → push → gh release.
 *
 * Usage (from repo root):
 *   npm run release -- patch
 *   npm run release -- minor
 *   npm run release -- major
 *   npm run release -- 0.1.1
 *
 * Options:
 *   --notes "…"     Release notes (default: commits since last tag)
 *   --skip-build    Reuse an already-built installer for the new version
 *   --dry-run       Print steps without writing, building, or publishing
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

const PRODUCT = "MnM Loot Splitter";
const NSIS_DIR = join(root, "src-tauri", "target", "release", "bundle", "nsis");

function usage(exitCode = 1) {
  console.error(`Usage: npm run release -- <patch|minor|major|x.y.z> [--notes "…"] [--skip-build] [--dry-run]`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { bump: null, notes: null, skipBuild: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--skip-build") {
      out.skipBuild = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--notes") {
      out.notes = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--notes=")) {
      out.notes = arg.slice("--notes=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      usage();
    }
    if (out.bump != null) {
      console.error(`Unexpected argument: ${arg}`);
      usage();
    }
    out.bump = arg;
  }
  if (!out.bump) usage();
  return out;
}

function run(command, args, { allowFail = false } = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
  } catch (error) {
    if (allowFail) return "";
    const stderr = error.stderr?.toString?.() ?? error.message;
    console.error(stderr);
    process.exit(1);
  }
}

function runInherit(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  try {
    execFileSync(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } catch {
    process.exit(1);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseVersion(raw) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) {
    console.error(`Invalid version: ${raw} (expected x.y.z)`);
    process.exit(1);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const v = parseVersion(current);
  if (bump === "major") return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
  if (bump === "minor") return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
  if (bump === "patch") return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1 });
  console.error(`Unknown bump: ${bump} (use patch, minor, major, or x.y.z)`);
  process.exit(1);
}

function setPackageVersion(version) {
  const path = join(root, "package.json");
  const pkg = readJson(path);
  pkg.version = version;
  writeJson(path, pkg);

  const lockPath = join(root, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages?.[""]) lock.packages[""].version = version;
    writeJson(lockPath, lock);
  }
}

function setTauriVersion(version) {
  const path = join(root, "src-tauri", "tauri.conf.json");
  const conf = readJson(path);
  conf.version = version;
  writeJson(path, conf);
}

function setCargoVersion(version) {
  const path = join(root, "src-tauri", "Cargo.toml");
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  if (next === text) {
    console.error("Could not update version in src-tauri/Cargo.toml");
    process.exit(1);
  }
  writeFileSync(path, next, "utf8");
}

function installerPath(version) {
  return join(NSIS_DIR, `${PRODUCT}_${version}_x64-setup.exe`);
}

function githubAssetName(version) {
  return `MnM_Loot_Splitter_${version}_x64-setup.exe`;
}

function defaultNotes(tag) {
  const lastTag = run("git", ["describe", "--tags", "--abbrev=0"], { allowFail: true });
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const log = run("git", ["log", range, "--pretty=format:- %s"], { allowFail: true });
  const body = log || "- Maintenance release.";
  return `## ${PRODUCT} ${tag.replace(/^v/, "")}\n\n${body}\n`;
}

function assertCleanTree() {
  const status = run("git", ["status", "--porcelain"]);
  if (status) {
    console.error("Working tree is not clean. Commit or stash changes before releasing:\n");
    console.error(status);
    process.exit(1);
  }
}

function assertTools() {
  run("git", ["--version"]);
  run("gh", ["--version"]);
  const auth = run("gh", ["auth", "status"], { allowFail: true });
  if (!auth) {
    console.error("GitHub CLI is not authenticated. Run: gh auth login");
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));
assertTools();
if (!args.dryRun) assertCleanTree();

const pkg = readJson(join(root, "package.json"));
const version = nextVersion(pkg.version, args.bump);
const tag = `v${version}`;
const setup = installerPath(version);
const assetName = githubAssetName(version);
const branch = run("git", ["branch", "--show-current"]) || "main";
const notes = args.notes ?? defaultNotes(tag);

console.log(`\nRelease ${tag} on branch ${branch}`);
console.log(`Installer: ${setup}`);
if (args.dryRun) console.log("(dry run — no changes)\n");

if (args.dryRun) {
  console.log(`Would bump ${pkg.version} → ${version}`);
  console.log(args.skipBuild ? "Would skip build" : "Would run: npm run tauri:build");
  console.log(`Would commit, tag ${tag}, push, and create GitHub release`);
  process.exit(0);
}

setPackageVersion(version);
setTauriVersion(version);
setCargoVersion(version);
console.log(`Version bumped to ${version}`);

if (!args.skipBuild) {
  runInherit("npm", ["run", "tauri:build"]);
} else {
  console.log("Skipping build (--skip-build)");
}

if (!existsSync(setup)) {
  console.error(`Installer not found:\n  ${setup}\nRun without --skip-build, or build first.`);
  process.exit(1);
}

runInherit("git", [
  "add",
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);
runInherit("git", ["commit", "-m", `Release ${tag}.`]);
runInherit("git", ["tag", tag]);
runInherit("git", ["push", "origin", branch]);
runInherit("git", ["push", "origin", tag]);

const notesFile = join(root, "desktop", ".cache", `release-notes-${version}.md`);
writeFileSync(notesFile, notes.endsWith("\n") ? notes : `${notes}\n`, "utf8");

runInherit("gh", [
  "release",
  "create",
  tag,
  `${setup}#${assetName}`,
  "--title",
  `${PRODUCT} ${version}`,
  "--notes-file",
  notesFile,
]);

console.log(`\nDone: https://github.com/FrantzCr/mnm-loot-spliter/releases/tag/${tag}`);
