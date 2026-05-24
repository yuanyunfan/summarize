import type { ContextSourceMeta } from "./runtime-contracts";
import type { Settings } from "./settings";

export type DebugDaemonRequestSummary = {
  kind: "summary" | "slides";
  requestedAt: string;
  url: string | null;
  reason: string | null;
  mode: string | null;
  length: string | null;
  language: string | null;
  maxCharacters: number | null;
  slides: boolean;
  slidesOcr: boolean;
  timestamps: boolean;
  noCache: boolean;
};

export type DebugSourceMetaSummary = {
  inputSource: string | null;
  requestedMode: string | null;
  contentStrategy: string | null;
  markdownProvider: string | null;
  firecrawlUsed: boolean | null;
  transcriptSource: string | null;
  transcriptCacheStatus: string | null;
  mediaKind: string | null;
  words: number | null;
  characters: number | null;
};

export type DebugSnapshot = {
  generatedAt: string;
  extension: {
    id: string | null;
    version: string | null;
    gitHash: string | null;
  };
  browser: {
    userAgent: string | null;
  };
  settings: {
    schemaVersion: number | null;
    model: string;
    length: string;
    language: string;
    requestMode: string;
    firecrawlMode: string;
    markdownMode: string;
    preprocessMode: string;
    youtubeMode: string;
    extendedLogging: boolean;
    tokenPresent: boolean;
  };
  daemon: {
    health: { ok: boolean; error?: string };
    authed: { ok: boolean; error?: string };
  };
  lastRun: {
    id: string | null;
    url: string | null;
    title: string | null;
    summaryFromCache: boolean | null;
    lastMeta: {
      model: string | null;
      modelLabel: string | null;
      inputSummary: string | null;
    };
    sourceMeta: DebugSourceMetaSummary | null;
  } | null;
  lastDaemonRequest: DebugDaemonRequestSummary | null;
};

export function summarizeSourceMeta(
  meta: ContextSourceMeta | null | undefined,
): DebugSourceMetaSummary | null {
  if (!meta) return null;
  return {
    inputSource: meta.input?.source ?? null,
    requestedMode: meta.input?.requestedMode ?? null,
    contentStrategy: meta.content?.strategy ?? null,
    markdownProvider: meta.content?.markdownProvider ?? null,
    firecrawlUsed: meta.content?.firecrawlUsed ?? null,
    transcriptSource: meta.transcript?.source ?? null,
    transcriptCacheStatus: meta.transcript?.cacheStatus ?? null,
    mediaKind: meta.media?.kind ?? null,
    words: meta.transcript?.wordCount ?? meta.content?.wordCount ?? null,
    characters: meta.transcript?.characters ?? meta.content?.totalCharacters ?? null,
  };
}

export function summarizeSettings(settings: Settings): DebugSnapshot["settings"] {
  return {
    schemaVersion:
      typeof settings.schemaVersion === "number" && Number.isFinite(settings.schemaVersion)
        ? settings.schemaVersion
        : null,
    model: settings.model,
    length: settings.length,
    language: settings.language,
    requestMode: settings.requestMode,
    firecrawlMode: settings.firecrawlMode,
    markdownMode: settings.markdownMode,
    preprocessMode: settings.preprocessMode,
    youtubeMode: settings.youtubeMode,
    extendedLogging: settings.extendedLogging,
    tokenPresent: settings.token.trim().length > 0,
  };
}
