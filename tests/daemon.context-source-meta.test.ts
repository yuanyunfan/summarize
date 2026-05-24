import { describe, expect, it } from "vitest";
import type { ExtractedLinkContent } from "../src/content/index.js";
import {
  buildUrlSourceMeta,
  buildVisiblePageSourceMeta,
} from "../src/daemon/context-source-meta.js";

function makeExtracted(overrides: Partial<ExtractedLinkContent> = {}): ExtractedLinkContent {
  return {
    url: "https://www.youtube.com/watch?v=abc123def45",
    title: "Demo",
    description: null,
    siteName: "YouTube",
    content: "Transcript:\nhello world",
    truncated: false,
    totalCharacters: 22,
    wordCount: 3,
    transcriptCharacters: 11,
    transcriptLines: 1,
    transcriptWordCount: 2,
    transcriptSource: "captionTracks",
    transcriptionProvider: null,
    transcriptMetadata: null,
    transcriptSegments: [{ startMs: 0, endMs: 1000, text: "hello world" }],
    transcriptTimedText: "[00:00] hello world",
    mediaDurationSeconds: 123,
    video: { kind: "youtube", url: "https://www.youtube.com/watch?v=abc123def45" },
    isVideoOnly: false,
    diagnostics: {
      strategy: "html",
      firecrawl: {
        attempted: false,
        used: false,
        cacheMode: "default",
        cacheStatus: "miss",
      },
      markdown: {
        requested: false,
        used: false,
        provider: null,
      },
      transcript: {
        cacheMode: "default",
        cacheStatus: "hit",
        textProvided: true,
        provider: "captionTracks",
        attemptedProviders: ["youtubei", "captionTracks"],
      },
    },
    ...overrides,
  };
}

describe("daemon context source meta", () => {
  it("builds page-source metadata for visible page summaries", () => {
    expect(
      buildVisiblePageSourceMeta({
        wordCount: 420,
        totalCharacters: 2400,
        truncated: true,
        requestedMode: "auto",
      }),
    ).toMatchObject({
      input: { source: "page", requestedMode: "auto" },
      content: {
        strategy: "readability",
        wordCount: 420,
        totalCharacters: 2400,
        truncated: true,
      },
      transcript: null,
      media: null,
    });
  });

  it("preserves transcript provider, cache, attempts, and media metadata", () => {
    expect(buildUrlSourceMeta({ extracted: makeExtracted(), requestedMode: "auto" })).toEqual({
      input: { source: "url", requestedMode: "auto" },
      content: {
        strategy: "html",
        markdownProvider: null,
        firecrawlUsed: false,
        totalCharacters: 22,
        wordCount: 3,
        truncated: false,
      },
      transcript: {
        source: "captionTracks",
        transcriptionProvider: null,
        cacheStatus: "hit",
        attemptedProviders: ["youtubei", "captionTracks"],
        characters: 11,
        wordCount: 2,
        lines: 1,
        hasTimestamps: true,
      },
      media: {
        kind: "youtube",
        durationSeconds: 123,
        isVideoOnly: false,
      },
    });
  });
});
