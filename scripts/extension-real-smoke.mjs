#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const shouldOpen = args.has("--open");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const extensionDir = path.join(repoRoot, "apps/chrome-extension/.output/chrome-mv3");
const manifestPath = path.join(extensionDir, "manifest.json");

const browsers = [
  {
    name: "Chrome",
    appName: "Google Chrome",
    appPath: "/Applications/Google Chrome.app",
    extensionsUrl: "chrome://extensions",
    profileRoot: path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
  },
  {
    name: "Edge",
    appName: "Microsoft Edge",
    appPath: "/Applications/Microsoft Edge.app",
    extensionsUrl: "edge://extensions",
    profileRoot: path.join(os.homedir(), "Library/Application Support/Microsoft Edge"),
  },
];

function canonical(value) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function checkDaemon() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch("http://127.0.0.1:8787/health", {
      signal: controller.signal,
    });
    return { ok: response.ok, detail: `${response.status} ${response.statusText}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function listProfileDirs(profileRoot) {
  if (!fs.existsSync(profileRoot)) return [];
  return fs
    .readdirSync(profileRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(profileRoot, entry.name))
    .filter((profileDir) => fs.existsSync(path.join(profileDir, "Preferences")));
}

function extensionPathMatches(entryPath, profileDir, expectedDir) {
  if (typeof entryPath !== "string" || entryPath.length === 0) return false;
  const candidate = path.isAbsolute(entryPath) ? entryPath : path.resolve(profileDir, entryPath);
  return canonical(candidate) === expectedDir;
}

function scanBrowser(browser, expectedDir) {
  const profiles = listProfileDirs(browser.profileRoot);
  const matches = [];

  for (const profileDir of profiles) {
    const preferences = readJson(path.join(profileDir, "Preferences"));
    const settings = preferences?.extensions?.settings;
    if (!settings || typeof settings !== "object") continue;

    for (const [id, entry] of Object.entries(settings)) {
      if (!entry || typeof entry !== "object") continue;
      const manifest = entry.manifest && typeof entry.manifest === "object" ? entry.manifest : {};
      const name = typeof manifest.name === "string" ? manifest.name : "";
      const version = typeof manifest.version === "string" ? manifest.version : "";
      const extensionPath = typeof entry.path === "string" ? entry.path : "";
      const isSummarize = /summarize/iu.test(name);
      const isExpectedPath = extensionPathMatches(extensionPath, profileDir, expectedDir);
      if (!isSummarize && !isExpectedPath) continue;

      matches.push({
        id,
        profile: path.basename(profileDir),
        name,
        version,
        path: extensionPath || "(missing path)",
        enabled: entry.state === 1,
        expectedPath: isExpectedPath,
      });
    }
  }

  return {
    appInstalled: fs.existsSync(browser.appPath),
    profiles: profiles.length,
    matches,
  };
}

function printBrowserResult(browser, result) {
  console.log(`${browser.name}:`);
  console.log(`  app: ${result.appInstalled ? "found" : "missing"} (${browser.appPath})`);
  console.log(`  profiles scanned: ${result.profiles}`);
  if (result.matches.length === 0) {
    console.log("  summarize extension: not found in scanned profiles");
    return;
  }
  for (const match of result.matches) {
    const flags = [
      match.enabled ? "enabled" : "disabled",
      match.expectedPath ? "expected-path" : "different-path",
    ].join(", ");
    console.log(
      `  ${match.profile}/${match.id}: ${match.name || "Summarize"} ${match.version || ""} (${flags})`,
    );
    console.log(`    path: ${match.path}`);
  }
}

const failures = [];
const manifest = readJson(manifestPath);
const expectedDir = canonical(extensionDir);

console.log("Summarize extension real-browser smoke");
console.log(`Build output: ${extensionDir}`);
if (!manifest) {
  console.log("Build: missing chrome-mv3 manifest; run pnpm -C apps/chrome-extension build");
  failures.push("missing extension build");
} else {
  const builtAt = fs.statSync(manifestPath).mtime.toISOString();
  console.log(
    `Build: ${manifest.name ?? "Summarize"} ${manifest.version ?? "unknown"} (${builtAt})`,
  );
}

const daemon = await checkDaemon();
console.log(`Daemon: ${daemon.ok ? "ok" : "not reachable"} (${daemon.detail})`);
if (!daemon.ok) failures.push("daemon is not reachable on http://127.0.0.1:8787/health");

if (process.platform !== "darwin") {
  console.log("Browser profile scan: skipped (macOS profile paths only)");
  if (strict) failures.push("browser profile scan is only implemented for macOS");
} else {
  for (const browser of browsers) {
    const result = scanBrowser(browser, expectedDir);
    printBrowserResult(browser, result);
    if (!result.appInstalled) failures.push(`${browser.name} is not installed`);

    const expectedMatches = result.matches.filter((match) => match.expectedPath);
    if (expectedMatches.length === 0) {
      failures.push(`${browser.name} has not loaded ${extensionDir}`);
    } else if (!expectedMatches.some((match) => match.enabled)) {
      failures.push(
        `${browser.name} summarize extension is loaded from ${extensionDir} but disabled`,
      );
    }

    if (shouldOpen) {
      try {
        execFileSync("open", ["-a", browser.appName, browser.extensionsUrl], { stdio: "ignore" });
      } catch (error) {
        failures.push(`failed to open ${browser.name} extensions page`);
      }
    }
  }
}

console.log("Manual smoke after reload:");
console.log("  1. Reload Summarize in chrome://extensions and edge://extensions.");
console.log("  2. Open the side panel on a normal web page.");
console.log("  3. Switch browser tabs; the panel should not start a new run automatically.");
console.log("  4. Click Summary/摘要 manually; only then should the active tab start summarizing.");

if (strict && failures.length > 0) {
  console.error("Strict smoke failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
