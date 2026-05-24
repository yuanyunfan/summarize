#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const repo = process.env.SUMMARIZE_REPO || process.cwd();
const durationMs = Number(process.env.SUMMARIZE_MONITOR_MS || 60 * 60 * 1000);
const intervalMs = Number(process.env.SUMMARIZE_MONITOR_INTERVAL_MS || 15_000);
const logPath =
  process.env.SUMMARIZE_MONITOR_LOG ||
  join("/tmp", `summarize-monitor-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
const endpoint = "http://127.0.0.1:8787";

mkdirSync(dirname(logPath), { recursive: true });

const seenLogLines = new Set();
let lastRestartAt = 0;
let healthFailures = 0;
let summarizeErrors = 0;
let summarizeDone = 0;
let loggedMissingDaemonLogFile = false;

function log(message, detail = null) {
  const line = `${new Date().toISOString()} ${message}${
    detail ? ` ${JSON.stringify(detail)}` : ""
  }`;
  console.log(line);
  writeFileSync(logPath, `${line}\n`, { flag: "a" });
}

function readToken() {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".summarize", "daemon.json"), "utf8"));
    return typeof config.token === "string" ? config.token : "";
  } catch {
    return "";
  }
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${endpoint}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function restartDaemon(reason) {
  const now = Date.now();
  if (now - lastRestartAt < 60_000) {
    log("skip_restart_recent", { reason });
    return;
  }
  lastRestartAt = now;
  log("restart_daemon_start", { reason });
  const result = spawnSync("pnpm", ["-s", "summarize", "daemon", "restart"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 45_000,
  });
  log("restart_daemon_done", {
    status: result.status,
    stdout: result.stdout.trim().slice(-600),
    stderr: result.stderr.trim().slice(-600),
  });
}

function summarizeLogObject(obj) {
  const event = typeof obj.event === "string" ? obj.event : "";
  const level = typeof obj.level === "string" ? obj.level : "";
  const message = typeof obj.message === "string" ? obj.message : "";
  const error =
    typeof obj.error === "string"
      ? obj.error
      : obj.error && typeof obj.error === "object" && typeof obj.error.message === "string"
        ? obj.error.message
        : "";
  const combined = `${event} ${level} ${message} ${error}`;

  if (event === "summarize.done") {
    summarizeDone += 1;
    log("summarize_done", {
      requestId: obj.requestId ?? null,
      url: obj.url ?? null,
      elapsedMs: obj.elapsedMs ?? null,
      lengthRaw: obj.lengthRaw ?? null,
      lengthTargetCharacters: obj.lengthTargetCharacters ?? null,
      summaryFromCache: obj.summaryFromCache ?? null,
      sourceMetaPresent: obj.sourceMetaPresent ?? null,
      sourceMetaInputSource: obj.sourceMetaInputSource ?? null,
      sourceMetaContentStrategy: obj.sourceMetaContentStrategy ?? null,
      sourceMetaTranscriptSource: obj.sourceMetaTranscriptSource ?? null,
    });
  }

  if (event === "summarize.error" || /\b(error|failed|unauthorized|5\d\d)\b/i.test(combined)) {
    summarizeErrors += 1;
    log("summarize_or_daemon_error", {
      event,
      level,
      requestId: obj.requestId ?? null,
      url: obj.url ?? null,
      error: error || message || null,
      lengthRaw: obj.lengthRaw ?? null,
      summaryFromCache: obj.summaryFromCache ?? null,
    });
  }

  const summary = typeof obj.summary === "string" ? obj.summary : "";
  if (
    /(?:^|\n)\s{0,3}(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i.test(summary) ||
    /(?:^|\n)\s{0,3}```\s*$/m.test(summary)
  ) {
    log("quality_issue_raw_diagram_or_fence", {
      event,
      requestId: obj.requestId ?? null,
      url: obj.url ?? null,
    });
  }
}

async function pollOnce() {
  try {
    const health = await fetchJson("/health");
    if (!health.ok || health.json?.ok !== true) {
      healthFailures += 1;
      log("health_failed", { status: health.status, body: health.json ?? health.text });
      if (healthFailures >= 2) restartDaemon("health_failed_twice");
      return;
    }
    healthFailures = 0;
  } catch (error) {
    healthFailures += 1;
    log("health_exception", { error: error instanceof Error ? error.message : String(error) });
    if (healthFailures >= 2) restartDaemon("health_exception_twice");
    return;
  }

  const token = readToken();
  if (!token) {
    log("missing_daemon_token");
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };
  const ping = await fetchJson("/v1/ping", { headers }).catch((error) => ({
    ok: false,
    status: 0,
    json: null,
    text: error instanceof Error ? error.message : String(error),
  }));
  if (!ping.ok) {
    log("auth_ping_failed", { status: ping.status, body: ping.json ?? ping.text });
    restartDaemon("auth_ping_failed");
    return;
  }

  const logs = await fetchJson("/v1/logs?source=daemon&tail=300&maxBytes=1000000", {
    headers,
  }).catch((error) => ({
    ok: false,
    status: 0,
    json: null,
    text: error instanceof Error ? error.message : String(error),
  }));
  if (!logs.ok) {
    const body = logs.json ?? logs.text;
    if (
      logs.status === 404 &&
      typeof body === "object" &&
      body !== null &&
      body.error === "Log file not found."
    ) {
      if (!loggedMissingDaemonLogFile) {
        loggedMissingDaemonLogFile = true;
        log("logs_waiting_for_first_daemon_event", { status: logs.status, body });
      }
    } else {
      log("logs_unavailable", { status: logs.status, body });
    }
  } else {
    loggedMissingDaemonLogFile = false;
    for (const line of logs.json?.lines ?? []) {
      if (seenLogLines.has(line)) continue;
      seenLogLines.add(line);
      let obj = null;
      try {
        obj = JSON.parse(line);
      } catch {}
      if (obj && typeof obj === "object") summarizeLogObject(obj);
    }
  }

  const processes = await fetchJson("/v1/processes?includeCompleted=true&limit=40", {
    headers,
  }).catch(() => null);
  const active = Array.isArray(processes?.json?.processes)
    ? processes.json.processes.filter((item) => item.status === "running")
    : [];
  if (active.length > 0) {
    log("active_processes", {
      count: active.length,
      items: active.map((item) => ({
        id: item.id,
        command: item.command,
        progress: item.progress,
        progressDetail: item.progressDetail,
      })),
    });
  }
}

async function main() {
  log("monitor_started", { repo, durationMs, intervalMs, logPath });
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await pollOnce();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  log("monitor_finished", { summarizeDone, summarizeErrors, logPath });
}

if (!existsSync(repo)) {
  throw new Error(`Repo path does not exist: ${repo}`);
}

main().catch((error) => {
  log("monitor_crashed", { error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
});
