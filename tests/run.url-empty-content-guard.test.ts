import { describe, expect, it } from "vitest";
import type { ExtractedLinkContent } from "../src/content/index.js";
import { assertSummarizableExtractedContent } from "../src/run/flows/url/flow.js";
import type { SlideExtractionResult } from "../src/slides/index.js";

const baseExtracted: ExtractedLinkContent = {
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  title: "Video",
  description: null,
  siteName: "YouTube",
  content: "",
  truncated: false,
  totalCharacters: 0,
  wordCount: 0,
  transcriptCharacters: null,
  transcriptLines: null,
  transcriptWordCount: null,
  transcriptSource: "unavailable",
  transcriptMetadata: null,
  transcriptSegments: null,
  transcriptTimedText: null,
  transcriptionProvider: null,
  mediaDurationSeconds: null,
  video: null,
  isVideoOnly: false,
  diagnostics: {
    strategy: "html",
    firecrawl: {
      attempted: false,
      used: false,
      cacheMode: "default",
      cacheStatus: "unknown",
      notes: null,
    },
    markdown: {
      requested: false,
      used: false,
      provider: null,
      notes: null,
    },
    transcript: {
      cacheMode: "default",
      cacheStatus: "miss",
      textProvided: false,
      provider: "unavailable",
      attemptedProviders: ["youtubei", "captionTracks", "unavailable"],
      notes: "captions unavailable",
    },
  },
};

const slidesWithOcr = {
  slides: [{ index: 1, timestamp: 0, ocrText: "Agenda", ocrConfidence: 0.9 }],
} as SlideExtractionResult;

describe("url flow empty content guard", () => {
  it("rejects empty YouTube extracts before sending an empty prompt to the model", () => {
    expect(() => assertSummarizableExtractedContent({ extracted: baseExtracted })).toThrow(
      /No YouTube transcript or page text was available/,
    );
  });

  it("allows normal extracted text", () => {
    expect(() =>
      assertSummarizableExtractedContent({
        extracted: { ...baseExtracted, content: "Transcript:\nHello", totalCharacters: 17 },
      }),
    ).not.toThrow();
  });

  it("allows slide OCR text to carry the prompt when transcript text is unavailable", () => {
    expect(() =>
      assertSummarizableExtractedContent({ extracted: baseExtracted, slides: slidesWithOcr }),
    ).not.toThrow();
  });
});
