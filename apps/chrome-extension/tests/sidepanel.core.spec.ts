import { expect, test, type Page } from "@playwright/test";
import { mockDaemonSummarize } from "./helpers/daemon-fixtures";
import {
  assertNoErrors,
  buildUiState,
  closeExtension,
  getBrowserFromProject,
  getExtensionUrl,
  getOpenPickerList,
  launchExtension,
  openExtensionPage,
  seedSettings,
  sendBgMessage,
  trackErrors,
  updateSettings,
  waitForPanelPort,
} from "./helpers/extension-harness";
import { allowFirefoxExtensionTests } from "./helpers/extension-test-config";
import {
  waitForChatEnabled,
  waitForSettingsHydratedHook,
  waitForSlidesRuntimeHooks,
} from "./helpers/panel-hooks";

test.skip(
  ({ browserName }) => browserName === "firefox" && !allowFirefoxExtensionTests,
  "Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.",
);

async function hasVisibleMermaidPixels(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const svg = document.querySelector(
      "#render .renderMermaid__viewport svg",
    ) as SVGSVGElement | null;
    if (!svg) return false;

    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.min(800, Math.ceil(rect.width)));
    const height = Math.max(1, Math.min(800, Math.ceil(rect.height)));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const markup = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    const loaded = new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    if (!(await loaded)) return false;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    let nonWhitePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha === 0) continue;
      const red = data[i] ?? 255;
      const green = data[i + 1] ?? 255;
      const blue = data[i + 2] ?? 255;
      if (Math.abs(red - 255) > 12 || Math.abs(green - 255) > 12 || Math.abs(blue - 255) > 12) {
        nonWhitePixels += 1;
      }
      if (nonWhitePixels > 64) return true;
    }
    return false;
  });
}

test("sidepanel loads without runtime errors", async ({ browserName: _browserName }, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await openExtensionPage(harness, "sidepanel.html", "#title");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel hides chat dock when chat is disabled", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { chatEnabled: false });
    const page = await harness.context.newPage();
    trackErrors(page, harness.pageErrors, harness.consoleErrors);
    await page.addInitScript(() => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await page.goto(getExtensionUrl(harness, "sidepanel.html"), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#title");
    await waitForPanelPort(page);
    await waitForPanelPort(page);
    await expect(page.locator("#chatDock")).toBeHidden();
    await expect(page.locator("#chatContainer")).toBeHidden();
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel updates chat visibility when settings change", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { chatEnabled: true });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title", () => {
      (window as typeof globalThis & { IntersectionObserver?: unknown }).IntersectionObserver =
        undefined;
    });
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await waitForChatEnabled(page, true);
    await expect(page.locator("#chatDock")).toBeVisible();

    await updateSettings(page, { chatEnabled: false });
    await waitForChatEnabled(page, false);
    await expect(page.locator("#chatDock")).toBeHidden();
    await expect(page.locator("#chatContainer")).toBeHidden();
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel scheme picker applies overlay selection", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, "sidepanel.html", "#title", () => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await waitForPanelPort(page);
    await page.evaluate(() => {
      const global = window as typeof globalThis & {
        __summarizePanelPort?: { disconnect?: () => void } | undefined;
      };
      global.__summarizePanelPort?.disconnect?.();
      global.__summarizePanelPort = undefined;
    });
    await page.click("#drawerToggle");
    await expect(page.locator("#drawer")).toBeVisible();

    const schemeLabel = page.locator("label.scheme");
    const schemeTrigger = schemeLabel.locator(".pickerTrigger");

    await schemeTrigger.focus();
    await schemeTrigger.press("Enter");
    const schemeList = getOpenPickerList(page);
    await expect(schemeList).toBeVisible();
    await schemeList.locator('[role="option"]').nth(1).click();

    await expect(schemeTrigger.locator(".scheme-label")).toHaveText("Cedar");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel refresh free models from advanced settings", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { token: "test-token", autoSummarize: false });

    let modelCalls = 0;
    await harness.context.route("http://127.0.0.1:8787/v1/models", async (route) => {
      modelCalls += 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          options: [
            { id: "auto", label: "Auto" },
            { id: "free", label: "Free (OpenRouter)" },
          ],
          providers: {
            openrouter: true,
            openai: false,
            google: false,
            anthropic: false,
            xai: false,
            zai: false,
          },
          openaiBaseUrl: null,
          localModelsSource: null,
        }),
      });
    });

    await harness.context.route("http://127.0.0.1:8787/v1/refresh-free", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, id: "refresh-1" }),
      });
    });

    const sseBody = [
      "event: status",
      'data: {"text":"Refresh free: scanning..."}',
      "",
      "event: done",
      "data: {}",
      "",
    ].join("\n");

    await harness.context.route(
      "http://127.0.0.1:8787/v1/refresh-free/refresh-1/events",
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sseBody,
        });
      },
    );

    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await page.click("#drawerToggle");
    await expect(page.locator("#drawer")).toBeVisible();
    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        status: "",
        settings: { tokenPresent: true, autoSummarize: false, model: "free", length: "xl" },
      }),
    });

    await page.locator("#advancedSettings summary").click();
    await expect(page.locator("#modelRefresh")).toBeVisible();
    await page.locator("#modelRefresh").click();
    await expect(page.locator("#modelStatus")).toContainText("免费模型已更新。");
    await expect.poll(() => modelCalls).toBeGreaterThanOrEqual(2);
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel refresh free shows error on failure", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { token: "test-token", autoSummarize: false });

    await harness.context.route("http://127.0.0.1:8787/v1/models", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          options: [
            { id: "auto", label: "Auto" },
            { id: "free", label: "Free (OpenRouter)" },
          ],
          providers: {
            openrouter: true,
            openai: false,
            google: false,
            anthropic: false,
            xai: false,
            zai: false,
          },
          openaiBaseUrl: null,
          localModelsSource: null,
        }),
      });
    });

    await harness.context.route("http://127.0.0.1:8787/v1/refresh-free", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "nope" }),
      });
    });

    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click("#drawerToggle");
    await expect(page.locator("#drawer")).toBeVisible();
    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        status: "",
        settings: { tokenPresent: true, autoSummarize: false, model: "free", length: "xl" },
      }),
    });

    await page.locator("#advancedSettings summary").click();
    await expect(page.locator("#modelRefresh")).toBeVisible();
    await page.locator("#modelRefresh").click();
    await expect(page.locator("#modelStatus")).toContainText("刷新免费模型失败");
    await expect(page.locator("#modelStatus")).toHaveAttribute("data-state", "error");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel mode picker applies overlay selection", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click("#drawerToggle");
    await expect(page.locator("#drawer")).toBeVisible();

    const modeLabel = page.locator("label.mode");
    const modeTrigger = modeLabel.locator(".pickerTrigger");

    await modeTrigger.focus();
    await modeTrigger.press("Enter");
    const modeList = getOpenPickerList(page);
    await expect(modeList).toBeVisible();
    const modeContent = page.locator(
      '#summarize-overlay-root .pickerPositioner[data-picker="mode"] .pickerContent:not([hidden])',
    );
    const pickerAlpha = await modeContent.evaluate((element) => {
      const background = getComputedStyle(element).backgroundColor;
      const rgba = /^rgba?\(([^)]+)\)$/.exec(background);
      if (!rgba) return 1;
      const parts = rgba[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length >= 4 ? Number(parts[3]) : 1;
    });
    expect(pickerAlpha).toBeGreaterThanOrEqual(0.85);
    await modeList.locator('[role="option"]').nth(2).click();

    await expect(modeTrigger).toHaveText("深色");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel custom length input accepts typing", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click("#drawerToggle");
    await expect(page.locator("#drawer")).toBeVisible();

    const lengthLabel = page.locator("label.length.mini");
    const lengthTrigger = lengthLabel.locator(".pickerTrigger").first();

    await lengthTrigger.click();
    const lengthList = getOpenPickerList(page);
    await expect(lengthList).toBeVisible();
    await lengthList.locator(".pickerOption", { hasText: "自定义…" }).click();

    const customInput = page.locator("#lengthCustom");
    await expect(customInput).toBeVisible();
    await customInput.click();
    await customInput.fill("20k");
    await expect(customInput).toHaveValue("20k");

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel updates title after stream when tab title changes", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { token: "test-token", autoSummarize: false });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    const sseBody = [
      "event: meta",
      'data: {"model":"test"}',
      "",
      "event: chunk",
      'data: {"text":"Hello world"}',
      "",
      "event: done",
      "data: {}",
      "",
    ].join("\n");

    await harness.context.route(
      /http:\/\/127\.0\.0\.1:8787\/v1\/summarize\/[^/]+\/events/,
      async (route) => {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sseBody,
        });
      },
    );

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: { id: 1, url: "https://example.com/video", title: "Original Title" },
        settings: { autoSummarize: false, tokenPresent: true },
        status: "",
      }),
    });

    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-1",
        url: "https://example.com/video",
        title: "Original Title",
        model: "auto",
        reason: "manual",
      },
    });

    await expect(page.locator("#title")).toHaveText("Original Title");
    await expect(page.locator("#render")).toContainText("Hello world");

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: { url: "https://example.com/video", title: "Updated Title" },
        status: "",
      }),
    });

    await expect(page.locator("#title")).toHaveText("Updated Title");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel renders mermaid summary code fences as diagrams", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSlidesRuntimeHooks(page);

    await page.evaluate(() => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: { applySummaryMarkdown?: (markdown: string) => void };
        }
      ).__summarizeTestHooks;
      hooks?.applySummaryMarkdown?.(
        ["```Mermaid", "flowchart TD", "A[Start] --> B[Preview]", "```"].join("\n"),
      );
    });

    const diagram = page.locator("#render .renderMermaid__viewport svg");
    await expect(diagram).toBeVisible();
    await expect(page.locator("#render pre > code")).toHaveCount(0);
    const box = await diagram.boundingBox();
    expect((box?.width ?? 0) > 0).toBe(true);
    expect((box?.height ?? 0) > 0).toBe(true);
    await expect.poll(() => hasVisibleMermaidPixels(page)).toBe(true);
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel keeps ASCII charts stable while the panel width changes", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);
    await waitForSlidesRuntimeHooks(page);
    await page.setViewportSize({ width: 420, height: 720 });

    const chartMarkdown = [
      "## 腾讯Buddy家族全景",
      "",
      "┌────────────────────────────┬────────────────────────────┬────────────────────────────┐",
      "| DataBuddy                  || CodeBuddy                  | WorkBuddy                  |",
      "| 面向数据从业者              || 面向开发者                 | 面向职场人                 |",
      "| 建数仓/做分析/指标治理       || 写代码/全栈开发/自动化办公  | 做文档/报告/项目协作        |",
      "└────────────────────────────┴────────────────────────────┴────────────────────────────┘",
      "",
      "共同底座：统一账号、计费和安全。",
    ].join("\n");

    await page.evaluate((markdown) => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: { applySummaryMarkdown?: (markdown: string) => void };
        }
      ).__summarizeTestHooks;
      hooks?.applySummaryMarkdown?.(markdown);
    }, chartMarkdown);

    const chart = page.locator("#render pre.renderAsciiChart");
    await expect(chart).toBeVisible();

    const narrow = await chart.evaluate((element) => {
      const render = document.querySelector("#render") as HTMLElement | null;
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        overflowX: style.overflowX,
        rectWidth: element.getBoundingClientRect().width,
        renderWidth: render?.getBoundingClientRect().width ?? 0,
        scrollWidth: element.scrollWidth,
        text: element.textContent,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(narrow.whiteSpace).toBe("pre");
    expect(narrow.overflowX === "auto" || narrow.overflowX === "scroll").toBe(true);
    expect(narrow.scrollWidth).toBeGreaterThan(narrow.clientWidth);
    expect(narrow.rectWidth).toBeLessThanOrEqual(narrow.renderWidth + 1);

    await page.setViewportSize({ width: 720, height: 720 });
    const wide = await chart.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(wide.text).toBe(narrow.text);
    expect(wide.whiteSpace).toBe("pre");

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel renders source metadata received from summary SSE", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { token: "test-token", autoSummarize: false });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");
    await waitForPanelPort(page);

    const sourceMeta = {
      input: { source: "url", requestedMode: "auto" },
      content: {
        strategy: "html",
        markdownProvider: null,
        firecrawlUsed: false,
        totalCharacters: 2400,
        wordCount: 420,
        truncated: false,
      },
      transcript: {
        source: "captionTracks",
        transcriptionProvider: null,
        cacheStatus: "hit",
        attemptedProviders: ["youtubei", "captionTracks"],
        characters: 1800,
        wordCount: 300,
        lines: 12,
        hasTimestamps: true,
      },
      media: { kind: "youtube", durationSeconds: 92, isVideoOnly: false },
    };
    const sseBody = [
      "event: meta",
      `data: ${JSON.stringify({
        model: "test",
        inputSummary: "1m 32s YouTube",
        summaryFromCache: true,
        sourceMeta,
      })}`,
      "",
      "event: chunk",
      'data: {"text":"Source metadata summary"}',
      "",
      "event: done",
      "data: {}",
      "",
    ].join("\n");

    await page.route("http://127.0.0.1:8787/v1/summarize/run-source/events", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: sseBody,
      });
    });

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: { id: 1, url: "https://www.youtube.com/watch?v=source123", title: "Source" },
        settings: { autoSummarize: false, tokenPresent: true },
      }),
    });
    await sendBgMessage(harness, {
      type: "run:start",
      run: {
        id: "run-source",
        url: "https://www.youtube.com/watch?v=source123",
        title: "Source",
        model: "auto",
        reason: "test",
      },
    });

    await expect(page.locator("#sourceMeta")).toBeVisible();
    await expect(page.locator("#sourceMeta")).toContainText("YouTube video");
    await expect(page.locator("#sourceMeta")).toContainText("YouTube captions");
    await expect(page.locator("#sourceMeta")).toContainText("summary cache");
    await expect(page.locator("#sourceMeta")).toContainText("attempted youtubei, captionTracks");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test("sidepanel clears summary when tab url changes", async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { token: "test-token", autoSummarize: false });
    const page = await openExtensionPage(harness, "sidepanel.html", "#title");

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: { url: "https://example.com/old", title: "Old Title" },
        settings: { autoSummarize: false, tokenPresent: true },
        status: "",
      }),
    });

    await expect(page.locator("#title")).toHaveText("Old Title");
    await page.evaluate(() => {
      const host = document.querySelector(".render__markdownHost") as HTMLElement | null;
      if (host) host.textContent = "Hello world";
    });
    await expect(page.locator(".render__markdownHost")).toContainText("Hello world");

    await sendBgMessage(harness, {
      type: "ui:state",
      state: buildUiState({
        tab: { url: "https://example.com/new", title: "New Title" },
        settings: { autoSummarize: false },
        status: "",
      }),
    });

    await expect(page.locator("#title")).toHaveText("New Title");
    await expect(page.locator("#render")).toContainText("点击摘要开始。");
    await expect(page.locator("#render")).toContainText("New Title");
    await expect(page.locator("#render")).not.toContainText("Hello world");
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
