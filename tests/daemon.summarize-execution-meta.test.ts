import { describe, expect, it, vi } from "vitest";
import type { CacheState } from "../src/cache.js";
import { createSession } from "../src/daemon/server-session.js";
import { executeSummarizeSession } from "../src/daemon/server-summarize-execution.js";
import type { ParsedSummarizeRequest } from "../src/daemon/server-summarize-request.js";
import { resolveRunOverrides } from "../src/run/run-settings.js";
import type { ContextSourceMeta } from "../src/shared/sse-events.js";

const mocks = vi.hoisted(() => ({
  extractContentForUrl: vi.fn(),
  streamSummaryForUrl: vi.fn(),
  streamSummaryForVisiblePage: vi.fn(),
}));

vi.mock("../src/daemon/summarize.js", () => ({
  extractContentForUrl: mocks.extractContentForUrl,
  streamSummaryForUrl: mocks.streamSummaryForUrl,
  streamSummaryForVisiblePage: mocks.streamSummaryForVisiblePage,
}));

function makeRequest(): ParsedSummarizeRequest {
  return {
    pageUrl: "https://example.com/source-meta",
    title: "Source meta",
    textContent: "Source metadata should be preserved across daemon meta events.",
    truncated: false,
    modelOverride: null,
    lengthRaw: "short",
    languageRaw: "zh-cn",
    promptOverride: null,
    noCache: true,
    extractOnly: false,
    mode: "page",
    maxCharacters: 120_000,
    format: "markdown",
    overrides: resolveRunOverrides({}),
    slidesSettings: null,
    diagnostics: { includeContent: false },
    hasText: true,
  };
}

describe("daemon summarize execution metadata", () => {
  it("forwards and preserves context source metadata in SSE meta events", async () => {
    const sourceMeta: ContextSourceMeta = {
      input: { source: "page", requestedMode: "page" },
      content: {
        strategy: "readability",
        markdownProvider: null,
        firecrawlUsed: null,
        totalCharacters: 64,
        wordCount: 8,
        truncated: false,
      },
      transcript: null,
      media: null,
    };

    mocks.streamSummaryForVisiblePage.mockImplementationOnce(async ({ sink }) => {
      sink.writeMeta?.({ inputSummary: "8 words · 64 chars", sourceMeta });
      sink.writeMeta?.({ summaryFromCache: true });
      return {
        usedModel: "openai/test-model",
        metrics: {
          elapsedMs: 1,
          summary: "Cached · example.com · test-model",
          details: null,
          summaryDetailed: "Cached · example.com · test-model",
          detailsDetailed: null,
        },
      };
    });

    const session = createSession(() => "session-1");
    await executeSummarizeSession({
      session,
      request: makeRequest(),
      env: {},
      fetchImpl: globalThis.fetch.bind(globalThis),
      cacheState: {
        mode: "bypass",
        store: null,
        ttlMs: 0,
        maxBytes: 0,
        path: null,
      } satisfies CacheState,
      mediaCache: null,
      port: 8787,
      includeContentLog: false,
      logStartedAt: Date.now(),
      logInput: null,
      logSlidesSettings: null,
      sessions: new Map([[session.id, session]]),
      refreshSessions: new Map(),
    });

    const metaEvents = session.buffer
      .map((entry) => entry.event)
      .filter((event) => event.event === "meta");

    expect(metaEvents.length).toBeGreaterThanOrEqual(3);
    expect(metaEvents[0].data.sourceMeta).toEqual(sourceMeta);
    expect(metaEvents[1].data.summaryFromCache).toBe(true);
    expect(metaEvents[1].data.sourceMeta).toEqual(sourceMeta);
    expect(metaEvents.at(-1)?.data.sourceMeta).toEqual(sourceMeta);
  });
});
