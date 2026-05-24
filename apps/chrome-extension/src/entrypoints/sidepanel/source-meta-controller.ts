import type { ContextSourceMeta, SseSlidesData } from "../../lib/runtime-contracts";

type SourceMetaRenderInput = {
  meta: ContextSourceMeta | null;
  slides: SseSlidesData | null;
  summaryFromCache: boolean | null;
  inputSummary: string | null;
};

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(value)}`;
}

function formatWords(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${formatCompactCount(value)} words`;
}

function formatChars(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${formatCompactCount(value)} chars`;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.round(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function inputLabel(source: ContextSourceMeta["input"]["source"] | null | undefined): string {
  if (source === "page") return "Page";
  if (source === "url") return "URL";
  return "Unknown input";
}

function mediaKindLabel(kind: NonNullable<ContextSourceMeta["media"]>["kind"]): string | null {
  if (kind === "youtube") return "YouTube video";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio";
  if (kind === "podcast") return "Podcast";
  if (kind === "media") return "Media";
  return null;
}

function contentStrategyLabel(strategy: string | null | undefined): string | null {
  const normalized = strategy?.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === "readability") return "Readability";
  if (lower === "html") return "HTML";
  if (lower === "firecrawl") return "Firecrawl";
  if (lower === "bird") return "X/Bird";
  if (lower === "xurl") return "X/xurl";
  if (lower === "nitter") return "Nitter";
  return normalized;
}

function transcriptSourceLabel(
  source: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  const normalized = source?.trim();
  if (!normalized) return null;
  if (normalized === "youtubei") return "YouTube transcript";
  if (normalized === "captionTracks") return "YouTube captions";
  if (normalized === "embedded") return "Embedded captions";
  if (normalized === "podcastTranscript") return "Podcast transcript";
  if (normalized === "yt-dlp") return provider ? `yt-dlp/${provider}` : "yt-dlp";
  if (normalized === "whisper") return provider ? `Transcription/${provider}` : "Transcription";
  if (normalized === "apify") return "Apify transcript";
  if (normalized === "html") return "HTML transcript";
  if (normalized === "unavailable") return "Transcript unavailable";
  if (normalized === "unknown") return "Unknown transcript";
  return provider ? `${normalized}/${provider}` : normalized;
}

function cacheLabel(status: string | null | undefined): string | null {
  if (!status || status === "unknown") return null;
  if (status === "hit") return "cache hit";
  if (status === "miss") return "cache miss";
  if (status === "bypassed") return "cache bypassed";
  if (status === "expired") return "cache expired";
  if (status === "fallback") return "cache fallback";
  return `cache ${status}`;
}

function appendText(parent: HTMLElement, text: string, className?: string) {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  parent.append(span);
}

function appendChip(parent: HTMLElement, text: string) {
  appendText(parent, text, "sourceMeta__chip");
}

function appendRow(parent: HTMLElement, label: string, values: Array<string | null | undefined>) {
  const clean = values.filter((value): value is string => Boolean(value && value.trim()));
  if (clean.length === 0) return;
  const row = document.createElement("div");
  row.className = "sourceMeta__row";
  appendText(row, label, "sourceMeta__label");
  appendText(row, clean.join(" · "), "sourceMeta__value");
  parent.append(row);
}

function firstSizeLabel(meta: ContextSourceMeta): string | null {
  return (
    formatWords(meta.transcript?.wordCount) ??
    formatWords(meta.content.wordCount) ??
    formatChars(meta.transcript?.characters) ??
    formatChars(meta.content.totalCharacters)
  );
}

function buildPrimaryLabel(meta: ContextSourceMeta): string {
  return (
    transcriptSourceLabel(meta.transcript?.source, meta.transcript?.transcriptionProvider) ??
    contentStrategyLabel(meta.content.strategy) ??
    inputLabel(meta.input.source)
  );
}

export function createSourceMetaController({ rootEl }: { rootEl: HTMLElement }) {
  const render = ({ meta, slides, summaryFromCache, inputSummary }: SourceMetaRenderInput) => {
    const hasSlides = Boolean(slides && slides.slides.length > 0);
    if (!meta && !hasSlides && summaryFromCache !== true) {
      rootEl.replaceChildren();
      rootEl.classList.add("hidden");
      return;
    }

    const details = document.createElement("details");
    details.className = "sourceMeta__details";
    const summary = document.createElement("summary");
    summary.className = "sourceMeta__summary";
    appendText(summary, "上下文", "sourceMeta__title");

    if (meta) {
      const media = mediaKindLabel(meta.media?.kind ?? null);
      appendChip(summary, media ?? inputLabel(meta.input.source));
      appendChip(summary, buildPrimaryLabel(meta));
      const size = firstSizeLabel(meta);
      if (size) appendChip(summary, size);
      const duration = formatDuration(meta.media?.durationSeconds);
      if (duration) appendChip(summary, duration);
      if (meta.transcript?.hasTimestamps) appendChip(summary, "timestamps");
    } else {
      appendChip(summary, "Cached");
      appendChip(summary, "source unknown");
    }

    if (summaryFromCache === true) appendChip(summary, "summary cache");
    if (hasSlides) appendChip(summary, `${slides!.slides.length} slides`);

    const body = document.createElement("div");
    body.className = "sourceMeta__body";

    if (meta) {
      appendRow(body, "输入", [
        inputLabel(meta.input.source),
        meta.input.requestedMode && meta.input.requestedMode !== meta.input.source
          ? `requested ${meta.input.requestedMode}`
          : null,
      ]);
      appendRow(body, "内容", [
        contentStrategyLabel(meta.content.strategy),
        meta.content.markdownProvider ? `markdown ${meta.content.markdownProvider}` : null,
        meta.content.firecrawlUsed ? "Firecrawl used" : null,
        formatWords(meta.content.wordCount),
        formatChars(meta.content.totalCharacters),
        meta.content.truncated ? "truncated" : null,
      ]);
      appendRow(body, "Transcript", [
        transcriptSourceLabel(meta.transcript?.source, meta.transcript?.transcriptionProvider),
        cacheLabel(meta.transcript?.cacheStatus),
        meta.transcript?.hasTimestamps ? "timestamps" : null,
        formatWords(meta.transcript?.wordCount),
        formatChars(meta.transcript?.characters),
        meta.transcript?.attemptedProviders?.length
          ? `attempted ${meta.transcript.attemptedProviders.join(", ")}`
          : null,
      ]);
      appendRow(body, "Media", [
        mediaKindLabel(meta.media?.kind ?? null),
        formatDuration(meta.media?.durationSeconds),
        meta.media?.isVideoOnly ? "video-only" : null,
      ]);
    } else if (inputSummary) {
      appendRow(body, "缓存", [inputSummary]);
    }

    if (hasSlides) {
      appendRow(body, "Slides", [
        slides!.sourceKind,
        `${slides!.slides.length} frames`,
        slides!.ocrAvailable ? "OCR available" : null,
      ]);
    }

    details.append(summary, body);
    rootEl.replaceChildren(details);
    rootEl.classList.remove("hidden");
  };

  return { render };
}
