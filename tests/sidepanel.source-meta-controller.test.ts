// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createSourceMetaController } from "../apps/chrome-extension/src/entrypoints/sidepanel/source-meta-controller.js";
import type { ContextSourceMeta } from "../apps/chrome-extension/src/lib/runtime-contracts.js";

describe("sidepanel source meta controller", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders compact transcript provenance and expandable details", () => {
    const rootEl = document.createElement("section");
    document.body.append(rootEl);
    const controller = createSourceMetaController({ rootEl });
    const meta: ContextSourceMeta = {
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
      media: {
        kind: "youtube",
        durationSeconds: 92,
        isVideoOnly: false,
      },
    };

    controller.render({
      meta,
      slides: {
        sourceUrl: "https://www.youtube.com/watch?v=abc",
        sourceId: "youtube-abc",
        sourceKind: "youtube",
        ocrAvailable: true,
        slides: [{ index: 1, timestamp: 0, imageUrl: "http://127.0.0.1/slide.png" }],
      },
      summaryFromCache: true,
      inputSummary: "1m 32s YouTube",
    });

    expect(rootEl.classList.contains("hidden")).toBe(false);
    expect(rootEl.textContent).toContain("YouTube video");
    expect(rootEl.textContent).toContain("YouTube captions");
    expect(rootEl.textContent).toContain("timestamps");
    expect(rootEl.textContent).toContain("summary cache");
    expect(rootEl.textContent).toContain("attempted youtubei, captionTracks");
    expect(rootEl.textContent).toContain("OCR available");
  });

  it("hides when no provenance is available", () => {
    const rootEl = document.createElement("section");
    document.body.append(rootEl);
    const controller = createSourceMetaController({ rootEl });

    controller.render({
      meta: null,
      slides: null,
      summaryFromCache: null,
      inputSummary: null,
    });

    expect(rootEl.classList.contains("hidden")).toBe(true);
    expect(rootEl.textContent).toBe("");
  });
});
