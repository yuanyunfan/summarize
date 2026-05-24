#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const articleUrl =
  process.env.SUMMARIZE_LIVE_E2E_ARTICLE_URL ?? "https://mp.weixin.qq.com/s/Hut4QX9l9SPyC9tvUqxT8A";
const videoUrl =
  process.env.SUMMARIZE_LIVE_E2E_VIDEO_URL ?? "https://www.youtube.com/watch?v=8lF7HmQ_RgY&t=2582s";
const length = process.env.SUMMARIZE_LIVE_E2E_LENGTH?.trim() || "long";
const language = process.env.SUMMARIZE_LIVE_E2E_LANGUAGE?.trim() || "zh-cn";
const requestTimeout = process.env.SUMMARIZE_LIVE_E2E_REQUEST_TIMEOUT?.trim() || "10m";
const maxOutputTokens = process.env.SUMMARIZE_LIVE_E2E_MAX_OUTPUT_TOKENS?.trim() || "4k";
const preferredModels = (
  process.env.SUMMARIZE_LIVE_E2E_PREFERRED_MODELS ?? "openai/accounts/msft/routers/fmfeto88"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (process.env.SUMMARIZE_LIVE_E2E === "0") {
  console.log("live E2E skipped because SUMMARIZE_LIVE_E2E=0");
  process.exit(0);
}

const env = {
  ...process.env,
  NO_COLOR: "1",
  SUMMARIZE_LIVE_E2E: "1",
  SUMMARIZE_LIVE_E2E_ARTICLE_URL: articleUrl,
  SUMMARIZE_LIVE_E2E_VIDEO_URL: videoUrl,
  SUMMARIZE_LIVE_E2E_LENGTH: length,
  SUMMARIZE_LIVE_E2E_LANGUAGE: language,
  SUMMARIZE_LIVE_E2E_REQUEST_TIMEOUT: requestTimeout,
  SUMMARIZE_LIVE_E2E_MAX_OUTPUT_TOKENS: maxOutputTokens,
};
delete env.FORCE_COLOR;

function run(label, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readDaemonToken() {
  const fromEnv = process.env.SUMMARIZE_DAEMON_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const daemonConfig = readJsonFile(join(homedir(), ".summarize", "daemon.json"));
  return typeof daemonConfig?.token === "string" && daemonConfig.token.trim()
    ? daemonConfig.token.trim()
    : null;
}

function readConfiguredModel() {
  const config = readJsonFile(join(homedir(), ".summarize", "config.json"));
  const model = config?.model;
  if (!model || typeof model !== "object") return null;
  const id = model.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function discoverDaemonModelIds() {
  const token = readDaemonToken();
  if (!token) return [];
  try {
    const response = await fetch("http://127.0.0.1:8787/v1/models", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.options)) return [];
    return payload.options
      .map((option) => (option && typeof option === "object" ? option.id : null))
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
  } catch {
    return [];
  }
}

async function resolveLiveModel() {
  const fromEnv = process.env.SUMMARIZE_LIVE_E2E_MODEL?.trim();
  if (fromEnv) return { model: fromEnv, source: "env" };

  const modelIds = await discoverDaemonModelIds();
  const modelSet = new Set(modelIds);
  for (const candidate of preferredModels) {
    if (modelSet.has(candidate)) return { model: candidate, source: "preferred daemon model" };
  }

  const configuredModel = readConfiguredModel();
  if (configuredModel && (modelSet.size === 0 || modelSet.has(configuredModel))) {
    return { model: configuredModel, source: "config" };
  }

  return { model: "auto", source: modelSet.size > 0 ? "fallback" : "undiscovered fallback" };
}

console.log("summarize live E2E gate");
console.log(`article: ${articleUrl}`);
console.log(`video:   ${videoUrl}`);
console.log(`length:  ${length}`);
console.log(`language: ${language}`);

run("build chrome extension", ["-C", "apps/chrome-extension", "build"]);
run("restart summarize daemon", ["-s", "summarize", "daemon", "restart"]);
run("verify summarize daemon status", ["-s", "summarize", "daemon", "status"]);
const liveModel = await resolveLiveModel();
env.SUMMARIZE_LIVE_E2E_MODEL = liveModel.model;
console.log(
  `model:   ${liveModel.model} (${liveModel.source}; override with SUMMARIZE_LIVE_E2E_MODEL)`,
);
run("run sidepanel live E2E", [
  "-C",
  "apps/chrome-extension",
  "exec",
  "playwright",
  "test",
  "-c",
  "playwright.config.ts",
  "--project=chromium",
  "tests/sidepanel.live-e2e.spec.ts",
]);
