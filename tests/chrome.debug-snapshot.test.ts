import { describe, expect, it } from "vitest";
import {
  summarizeSettings,
  summarizeSourceMeta,
} from "../apps/chrome-extension/src/lib/debug-snapshot.js";
import type { ContextSourceMeta } from "../apps/chrome-extension/src/lib/runtime-contracts.js";
import { defaultSettings } from "../apps/chrome-extension/src/lib/settings.js";

describe("chrome/debug-snapshot", () => {
  it("redacts settings secrets and keeps effective diagnostics", () => {
    expect(
      summarizeSettings({
        ...defaultSettings,
        token: "secret-token",
        length: "medium",
        extendedLogging: true,
      }),
    ).toMatchObject({
      tokenPresent: true,
      length: "medium",
      extendedLogging: true,
    });
  });

  it("summarizes source metadata without raw content", () => {
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
      media: { kind: "youtube", durationSeconds: 92, isVideoOnly: false },
    };

    expect(summarizeSourceMeta(meta)).toEqual({
      inputSource: "url",
      requestedMode: "auto",
      contentStrategy: "html",
      markdownProvider: null,
      firecrawlUsed: false,
      transcriptSource: "captionTracks",
      transcriptCacheStatus: "hit",
      mediaKind: "youtube",
      words: 300,
      characters: 1800,
    });
  });
});
