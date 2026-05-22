import { expect, test } from "@playwright/test";
import {
  getSummarizeBodies,
  getSummarizeCalls,
  mockDaemonSummarize,
} from "./helpers/daemon-fixtures";
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
  sendBgMessage,
  sendPanelMessage,
  waitForActiveTabUrl,
  waitForPanelPort,
} from "./helpers/extension-harness";

test("sidepanel keeps the current summary sticky when switching YouTube tabs", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { token: "test-token", autoSummarize: true, slidesEnabled: false });
    await harness.context.route("https://www.youtube.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html><body><article>YouTube placeholder</article></body></html>",
      });
    });

    const videoA = "https://www.youtube.com/watch?v=videoA12345";
    const videoB = "https://www.youtube.com/watch?v=videoB67890";

    const pageA = await harness.context.newPage();
    await pageA.goto(videoA, { waitUntil: "domcontentloaded" });
    const pageB = await harness.context.newPage();
    await pageB.goto(videoB, { waitUntil: "domcontentloaded" });

    await activateTabByUrl(harness, videoA);
    await waitForActiveTabUrl(harness, videoA);
    await injectContentScript(harness, "content-scripts/extract.js", videoA);
    await injectContentScript(harness, "content-scripts/extract.js", videoB);

    const sseBody = (text: string) =>
      ["event: chunk", `data: ${JSON.stringify({ text })}`, "", "event: done", "data: {}", ""].join(
        "\n",
      );
    await harness.context.route("http://127.0.0.1:8787/v1/summarize/**/events", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sseBody("Video A summary"),
      });
    });
    const panel = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(panel);
    await maybeBringToFront(pageA);
    await activateTabByUrl(harness, videoA);
    await waitForActiveTabUrl(harness, videoA);
    await mockDaemonSummarize(harness);

    const waitForSummarizeCall = async (sinceCount: number) => {
      await expect
        .poll(async () => await getSummarizeCalls(harness), { timeout: 5_000 })
        .toBeGreaterThan(sinceCount);
    };
    const getSummaryRequestCount = async () => {
      const bodies = (await getSummarizeBodies(harness)) as Array<Record<string, unknown>>;
      return bodies.filter((body) => body?.extractOnly !== true).length;
    };

    const callsBeforeReady = await getSummarizeCalls(harness);
    await sendPanelMessage(panel, { type: "panel:ready" });
    await waitForSummarizeCall(callsBeforeReady);
    await expect
      .poll(async () => {
        const bodies = (await getSummarizeBodies(harness)) as Array<Record<string, unknown>>;
        return bodies.some((body) => body?.url === videoA && body?.extractOnly !== true);
      })
      .toBe(true);
    await expect(panel.locator("#render")).toContainText("Video A summary");

    const summaryRequestsBeforeB = await getSummaryRequestCount();
    await activateTabByUrl(harness, videoB);
    await waitForActiveTabUrl(harness, videoB);
    await panel.waitForTimeout(1_000);
    expect(await getSummaryRequestCount()).toBe(summaryRequestsBeforeB);
    await expect(panel.locator("#render")).toContainText("Video A summary");
    await expect(panel.locator("#render")).not.toContainText("Video B summary");

    const summaryRequestsBeforeReturn = await getSummaryRequestCount();
    await activateTabByUrl(harness, videoA);
    await waitForActiveTabUrl(harness, videoA);
    await panel.waitForTimeout(1_000);
    expect(await getSummaryRequestCount()).toBe(summaryRequestsBeforeReturn);
    await expect(panel.locator("#render")).toContainText("Video A summary");

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
