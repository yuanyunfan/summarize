import { expect, test, type Page } from "@playwright/test";
import type { DebugSnapshot } from "../src/lib/debug-snapshot";
import { DAEMON_PORT, isPortInUse, readDaemonToken } from "./helpers/daemon-fixtures";
import {
  activateTabByUrl,
  assertNoErrors,
  closeExtension,
  getBrowserFromProject,
  injectContentScript,
  launchExtension,
  maybeBringToFront,
  openExtensionPage,
  seedSettings,
  sendPanelMessage,
  waitForActiveTabUrl,
  waitForPanelPort,
} from "./helpers/extension-harness";
import { allowFirefoxExtensionTests } from "./helpers/extension-test-config";
import { getPanelPhase, getPanelSummaryMarkdown } from "./helpers/panel-hooks";

const allowLiveE2E = process.env.SUMMARIZE_LIVE_E2E === "1";
const articleUrl =
  process.env.SUMMARIZE_LIVE_E2E_ARTICLE_URL ?? "https://mp.weixin.qq.com/s/Hut4QX9l9SPyC9tvUqxT8A";
const videoUrl =
  process.env.SUMMARIZE_LIVE_E2E_VIDEO_URL ?? "https://www.youtube.com/watch?v=8lF7HmQ_RgY&t=2582s";
const model = process.env.SUMMARIZE_LIVE_E2E_MODEL?.trim() || "auto";
const length = process.env.SUMMARIZE_LIVE_E2E_LENGTH?.trim() || "long";
const language = process.env.SUMMARIZE_LIVE_E2E_LANGUAGE?.trim() || "zh-cn";
const requestTimeout = process.env.SUMMARIZE_LIVE_E2E_REQUEST_TIMEOUT?.trim() || "10m";
const maxOutputTokens = process.env.SUMMARIZE_LIVE_E2E_MAX_OUTPUT_TOKENS?.trim() || "4k";
const maxCharsRaw = Number(process.env.SUMMARIZE_LIVE_E2E_MAX_CHARS ?? "300000");
const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? maxCharsRaw : 300_000;
const runTimeoutRaw = Number(process.env.SUMMARIZE_LIVE_E2E_TIMEOUT_MS ?? "900000");
const runTimeoutMs = Number.isFinite(runTimeoutRaw) && runTimeoutRaw > 0 ? runTimeoutRaw : 900_000;
const liveRetriesRaw = Number(process.env.SUMMARIZE_LIVE_E2E_TEST_RETRIES ?? "1");
const liveRetries =
  Number.isFinite(liveRetriesRaw) && liveRetriesRaw >= 0 ? Math.floor(liveRetriesRaw) : 1;
const llmRetriesRaw = Number(process.env.SUMMARIZE_LIVE_E2E_LLM_RETRIES ?? "1");
const llmRetries =
  Number.isFinite(llmRetriesRaw) && llmRetriesRaw >= 0 ? Math.floor(llmRetriesRaw) : 1;

test.skip(
  ({ browserName }) => browserName === "firefox" && !allowFirefoxExtensionTests,
  "Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.",
);
test.describe.configure({ retries: liveRetries });

async function requireLivePrerequisites(testInfo: { project: { name: string } }): Promise<string> {
  if (!allowLiveE2E) {
    test.skip(true, "Set SUMMARIZE_LIVE_E2E=1 to run live sidepanel E2E tests.");
  }
  if (testInfo.project.name === "firefox") {
    test.skip(true, "Live sidepanel E2E is only validated in Chromium.");
  }
  const token = readDaemonToken();
  if (!token) {
    throw new Error(
      "Daemon token missing (set SUMMARIZE_DAEMON_TOKEN or ~/.summarize/daemon.json).",
    );
  }
  if (!(await isPortInUse(DAEMON_PORT))) {
    throw new Error(`Daemon must be running on ${DAEMON_PORT}.`);
  }
  return token;
}

async function readDebugSnapshot(page: Page): Promise<DebugSnapshot> {
  const response = await page.evaluate(async () => {
    return await new Promise<{ ok?: boolean; snapshot?: DebugSnapshot; error?: string }>(
      (resolve) => {
        chrome.runtime.sendMessage({ type: "debug:snapshot" }, (value) => {
          const lastError = chrome.runtime.lastError?.message;
          if (lastError) {
            resolve({ ok: false, error: lastError });
            return;
          }
          resolve(value as { ok?: boolean; snapshot?: DebugSnapshot; error?: string });
        });
      },
    );
  });
  if (!response.ok || !response.snapshot) {
    throw new Error(response.error || "debug snapshot unavailable");
  }
  return response.snapshot;
}

function cjkRatio(value: string): number {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return 0;
  const cjk = compact.match(/[\u3400-\u9fff]/gu) ?? [];
  return cjk.length / compact.length;
}

function expectChineseSummary(summary: string) {
  expect(summary.trim().length).toBeGreaterThan(120);
  expect(cjkRatio(summary)).toBeGreaterThan(0.2);
  expect(summary).not.toContain("\uFFFD");
  const fenceCount = summary.match(/```/g)?.length ?? 0;
  expect(fenceCount % 2).toBe(0);
}

async function assertNoVisibleErrors(page: Page) {
  const errors = await collectVisibleErrors(page);
  expect(errors).toEqual([]);
}

async function collectVisibleErrors(page: Page): Promise<string[]> {
  return await page
    .locator("#error:not(.hidden), #inlineError:not(.hidden)")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()).filter(Boolean));
}

function formatDebugSnapshot(snapshot: DebugSnapshot | null): string {
  if (!snapshot) return "debug snapshot unavailable";
  return JSON.stringify(
    {
      settings: snapshot.settings,
      lastDaemonRequest: snapshot.lastDaemonRequest,
      lastRun: snapshot.lastRun,
      daemon: snapshot.daemon,
    },
    null,
    2,
  );
}

async function waitForSummaryMarkdownOrThrow(page: Page): Promise<string> {
  const deadline = Date.now() + runTimeoutMs;
  let lastPhase: string | null = null;

  while (Date.now() < deadline) {
    const errors = await collectVisibleErrors(page);
    if (errors.length > 0) {
      const snapshot = await readDebugSnapshot(page).catch(() => null);
      throw new Error(
        `sidepanel live summary failed: ${errors.join(" | ")}\n${formatDebugSnapshot(snapshot)}`,
      );
    }

    const summary = (await getPanelSummaryMarkdown(page)).trim();
    if (summary.length > 120) return summary;
    lastPhase = await getPanelPhase(page);
    await page.waitForTimeout(1000);
  }

  const snapshot = await readDebugSnapshot(page).catch(() => null);
  throw new Error(
    `timed out waiting for live summary markdown (last phase=${lastPhase ?? "unknown"}).\n${formatDebugSnapshot(
      snapshot,
    )}`,
  );
}

async function waitForIdleOrThrow(page: Page) {
  const deadline = Date.now() + runTimeoutMs;
  while (Date.now() < deadline) {
    const errors = await collectVisibleErrors(page);
    if (errors.length > 0) {
      const snapshot = await readDebugSnapshot(page).catch(() => null);
      throw new Error(
        `sidepanel live summary failed before idle: ${errors.join(" | ")}\n${formatDebugSnapshot(
          snapshot,
        )}`,
      );
    }
    if ((await getPanelPhase(page)) === "idle") return;
    await page.waitForTimeout(1000);
  }
  const snapshot = await readDebugSnapshot(page).catch(() => null);
  throw new Error(`timed out waiting for sidepanel idle.\n${formatDebugSnapshot(snapshot)}`);
}

async function waitForBodyText(page: Page, minChars: number) {
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          return document.body?.innerText?.trim().length ?? 0;
        }),
      { timeout: 90_000 },
    )
    .toBeGreaterThan(minChars);
}

async function waitForFreshRequest(page: Page, url: string, previousRequestedAt: string | null) {
  await expect
    .poll(
      async () => {
        const request = (await readDebugSnapshot(page)).lastDaemonRequest;
        if (!request) return "";
        if (request.url !== url) return "";
        if (request.requestedAt === previousRequestedAt) return "";
        return request.noCache ? request.requestedAt : "";
      },
      { timeout: 90_000 },
    )
    .not.toBe("");
}

async function runPanelSummary({
  page,
  url,
  inputMode,
}: {
  page: Page;
  url: string;
  inputMode?: "page" | "video";
}) {
  const before = await readDebugSnapshot(page).catch(() => null);
  const previousRequestedAt = before?.lastDaemonRequest?.requestedAt ?? null;

  await sendPanelMessage(page, {
    type: "panel:summarize",
    refresh: true,
    ...(inputMode ? { inputMode } : {}),
  });
  await waitForFreshRequest(page, url, previousRequestedAt);
  const summary = await waitForSummaryMarkdownOrThrow(page);
  await waitForIdleOrThrow(page);
  await assertNoVisibleErrors(page);

  const snapshot = await readDebugSnapshot(page);
  return { summary, snapshot };
}

test.describe("live sidepanel E2E", () => {
  test("summarizes a live article in Simplified Chinese without cache", async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(runTimeoutMs + 180_000);
    const token = await requireLivePrerequisites(testInfo);
    const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

    try {
      await seedSettings(harness, {
        token,
        autoSummarize: false,
        slidesEnabled: false,
        slidesParallel: true,
        summaryTimestamps: true,
        extendedLogging: true,
        model,
        length,
        language,
        promptOverride: "",
        maxChars,
        timeout: requestTimeout,
        retries: llmRetries,
        maxOutputTokens,
      });

      const panel = await openExtensionPage(harness, "sidepanel.html", "#title");
      await waitForPanelPort(panel);

      const contentPage = await harness.context.newPage();
      await contentPage.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await contentPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await waitForBodyText(contentPage, 1000);
      await maybeBringToFront(contentPage);
      await activateTabByUrl(harness, "https://mp.weixin.qq.com/s/");
      await waitForActiveTabUrl(harness, "https://mp.weixin.qq.com/s/");
      await injectContentScript(
        harness,
        "content-scripts/extract.js",
        "https://mp.weixin.qq.com/s/",
      );

      const { summary, snapshot } = await runPanelSummary({
        page: panel,
        url: articleUrl,
        inputMode: "page",
      });

      expectChineseSummary(summary);
      expect(snapshot.lastDaemonRequest).toMatchObject({
        kind: "summary",
        language,
        noCache: true,
      });
      expect(snapshot.lastRun?.summaryFromCache).toBe(false);
      expect(snapshot.lastRun?.sourceMeta?.characters ?? 0).toBeGreaterThan(1000);
      assertNoErrors(harness);
    } finally {
      await closeExtension(harness.context, harness.userDataDir);
    }
  });

  test("summarizes a live YouTube video transcript in Simplified Chinese without cache", async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(runTimeoutMs + 180_000);
    const token = await requireLivePrerequisites(testInfo);
    const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

    try {
      await seedSettings(harness, {
        token,
        autoSummarize: false,
        slidesEnabled: false,
        slidesParallel: true,
        summaryTimestamps: true,
        extendedLogging: true,
        model,
        length,
        language,
        promptOverride: "",
        maxChars,
        timeout: requestTimeout,
        retries: llmRetries,
        maxOutputTokens,
      });

      const panel = await openExtensionPage(harness, "sidepanel.html", "#title");
      await waitForPanelPort(panel);

      const contentPage = await harness.context.newPage();
      await contentPage.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await waitForBodyText(contentPage, 200);
      await maybeBringToFront(contentPage);
      await activateTabByUrl(harness, "https://www.youtube.com/watch");
      await waitForActiveTabUrl(harness, "https://www.youtube.com/watch");

      const { summary, snapshot } = await runPanelSummary({
        page: panel,
        url: videoUrl,
        inputMode: "video",
      });

      const sourceCharacters = snapshot.lastRun?.sourceMeta?.characters ?? 0;
      expectChineseSummary(summary);
      expect(summary).toMatch(/\[\d{1,2}:\d{2}(?::\d{2})?\]/);
      expect(snapshot.lastDaemonRequest).toMatchObject({
        kind: "summary",
        mode: "url",
        language,
        timestamps: true,
        noCache: true,
      });
      expect(snapshot.lastRun?.summaryFromCache).toBe(false);
      expect(snapshot.lastRun?.sourceMeta?.transcriptSource).not.toBeNull();
      expect(snapshot.lastRun?.sourceMeta?.transcriptCacheStatus).toBe("bypassed");
      expect(sourceCharacters).toBeGreaterThan(10_000);
      expect(summary.length).toBeLessThan(Math.round(sourceCharacters * 0.4));
      assertNoErrors(harness);
    } finally {
      await closeExtension(harness.context, harness.userDataDir);
    }
  });
});
