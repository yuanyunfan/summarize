import { isYouTubeUrl, type ExtractedLinkContent } from "../content/index.js";
import type { ContextSourceMeta } from "../shared/sse-events.js";

type RequestedMode = ContextSourceMeta["input"]["requestedMode"];

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveMediaKind(
  extracted: Pick<
    ExtractedLinkContent,
    "url" | "siteName" | "video" | "isVideoOnly" | "transcriptCharacters"
  >,
): NonNullable<ContextSourceMeta["media"]>["kind"] {
  if (extracted.siteName === "YouTube" || isYouTubeUrl(extracted.url)) return "youtube";
  if (extracted.video || extracted.isVideoOnly) return "video";
  if (typeof extracted.transcriptCharacters === "number" && extracted.transcriptCharacters > 0) {
    const site = extracted.siteName?.toLowerCase() ?? "";
    if (site.includes("podcast") || site === "spotify") return "podcast";
    return "audio";
  }
  return null;
}

function buildTranscriptMeta(extracted: ExtractedLinkContent): ContextSourceMeta["transcript"] {
  const diagnostics = extracted.diagnostics.transcript;
  const attemptedProviders = Array.isArray(diagnostics.attemptedProviders)
    ? [...diagnostics.attemptedProviders]
    : [];
  const source = extracted.transcriptSource ?? diagnostics.provider ?? null;
  const characters = finiteNumber(extracted.transcriptCharacters);
  const wordCount = finiteNumber(extracted.transcriptWordCount);
  const lines = finiteNumber(extracted.transcriptLines);
  const hasTimestamps =
    Array.isArray(extracted.transcriptSegments) && extracted.transcriptSegments.length > 0
      ? true
      : typeof extracted.transcriptTimedText === "string" &&
          extracted.transcriptTimedText.length > 0
        ? true
        : null;

  if (
    !source &&
    attemptedProviders.length === 0 &&
    !characters &&
    !wordCount &&
    !lines &&
    !extracted.transcriptionProvider
  ) {
    return null;
  }

  return {
    source,
    transcriptionProvider: extracted.transcriptionProvider ?? null,
    cacheStatus: diagnostics.cacheStatus ?? null,
    attemptedProviders,
    characters,
    wordCount,
    lines,
    hasTimestamps,
  };
}

export function buildVisiblePageSourceMeta({
  wordCount,
  totalCharacters,
  truncated,
  requestedMode,
}: {
  wordCount: number;
  totalCharacters: number;
  truncated: boolean;
  requestedMode: RequestedMode;
}): ContextSourceMeta {
  return {
    input: {
      source: "page",
      requestedMode,
    },
    content: {
      strategy: "readability",
      markdownProvider: null,
      firecrawlUsed: false,
      totalCharacters,
      wordCount,
      truncated,
    },
    transcript: null,
    media: null,
  };
}

export function buildUrlSourceMeta({
  extracted,
  requestedMode,
}: {
  extracted: ExtractedLinkContent;
  requestedMode: RequestedMode;
}): ContextSourceMeta {
  const mediaKind = deriveMediaKind(extracted);
  return {
    input: {
      source: "url",
      requestedMode,
    },
    content: {
      strategy: extracted.diagnostics.strategy ?? null,
      markdownProvider: extracted.diagnostics.markdown.used
        ? (extracted.diagnostics.markdown.provider ?? "unknown")
        : null,
      firecrawlUsed: extracted.diagnostics.firecrawl.used ?? null,
      totalCharacters: finiteNumber(extracted.totalCharacters),
      wordCount: finiteNumber(extracted.wordCount),
      truncated: extracted.truncated,
    },
    transcript: buildTranscriptMeta(extracted),
    media:
      mediaKind || extracted.mediaDurationSeconds
        ? {
            kind: mediaKind,
            durationSeconds: finiteNumber(extracted.mediaDurationSeconds),
            isVideoOnly: extracted.isVideoOnly,
          }
        : null,
  };
}
