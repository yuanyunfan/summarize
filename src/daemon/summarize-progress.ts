import { type LinkPreviewProgressEvent, ProgressKind } from "@steipete/summarize-core/content";
import type { SseProgressData, SseProgressPhase } from "../shared/sse-events.js";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function percentFromRatio(numerator: number | null, denominator: number | null): number | null {
  if (typeof numerator !== "number" || typeof denominator !== "number") return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return clampPercent((numerator / denominator) * 100);
}

function createProgressData({
  phase,
  text,
  label,
  detail = null,
  percent = null,
  stepIndex = null,
  stepTotal = null,
}: {
  phase: SseProgressPhase;
  text: string;
  label: string;
  detail?: string | null;
  percent?: number | null;
  stepIndex?: number | null;
  stepTotal?: number | null;
}): SseProgressData {
  return {
    phase,
    text,
    label,
    detail,
    percent: typeof percent === "number" && Number.isFinite(percent) ? clampPercent(percent) : null,
    stepIndex:
      typeof stepIndex === "number" && Number.isFinite(stepIndex) ? Math.max(0, stepIndex) : null,
    stepTotal:
      typeof stepTotal === "number" && Number.isFinite(stepTotal) && stepTotal > 0
        ? Math.max(1, stepTotal)
        : null,
  };
}

export function createProgressStatus(
  phase: SseProgressPhase,
  text: string,
  label: string,
  options?: {
    detail?: string | null;
    percent?: number | null;
    stepIndex?: number | null;
    stepTotal?: number | null;
  },
): SseProgressData {
  return createProgressData({ phase, text, label, ...options });
}

export function formatProgressEvent(event: LinkPreviewProgressEvent): SseProgressData | null {
  switch (event.kind) {
    case ProgressKind.FetchHtmlStart:
      return createProgressData({
        phase: "fetching",
        text: "Fetching…",
        label: "Fetching page",
      });
    case ProgressKind.FetchHtmlProgress: {
      const percent = percentFromRatio(event.downloadedBytes, event.totalBytes);
      return createProgressData({
        phase: "fetching",
        text: `Fetching…${percent == null ? "" : ` ${percent}%`}`,
        label: "Fetching page",
        percent,
      });
    }
    case ProgressKind.FetchHtmlDone:
      return createProgressData({
        phase: "fetching",
        text: "Fetching: done",
        label: "Fetched page",
        percent: 100,
      });
    case ProgressKind.FirecrawlStart:
      return createProgressData({
        phase: "fetching",
        text: `Firecrawl… (${event.reason})`,
        label: "Fetching with Firecrawl",
        detail: event.reason,
      });
    case ProgressKind.FirecrawlDone:
      return createProgressData({
        phase: "fetching",
        text: event.ok ? "Firecrawl: done" : "Firecrawl: failed",
        label: event.ok ? "Firecrawl finished" : "Firecrawl failed",
        percent: event.ok ? 100 : null,
      });
    case ProgressKind.TranscriptStart:
      return createProgressData({
        phase: "transcript",
        text: event.hint?.trim() ? event.hint.trim() : "Transcript…",
        label: "Fetching transcript",
      });
    case ProgressKind.TranscriptMediaDownloadStart:
      return createProgressData({
        phase: "downloading",
        text: `${event.service}: downloading audio…`,
        label: "Downloading audio",
      });
    case ProgressKind.TranscriptMediaDownloadProgress: {
      const percent = percentFromRatio(event.downloadedBytes, event.totalBytes);
      return createProgressData({
        phase: "downloading",
        text: `${event.service}: downloading audio…${percent == null ? "" : ` ${percent}%`}`,
        label: "Downloading audio",
        percent,
      });
    }
    case ProgressKind.TranscriptMediaDownloadDone:
      return createProgressData({
        phase: "downloading",
        text: `${event.service}: downloaded audio`,
        label: "Downloaded audio",
        percent: 100,
      });
    case ProgressKind.TranscriptWhisperStart:
      return createProgressData({
        phase: "transcribing",
        text: `${event.service}: transcribing…`,
        label: "Transcribing audio",
        stepTotal: event.parts,
      });
    case ProgressKind.TranscriptWhisperProgress: {
      const percentFromDuration = percentFromRatio(
        event.processedDurationSeconds,
        event.totalDurationSeconds,
      );
      const normalizedParts = event.parts ? Math.max(1, event.parts) : null;
      const percentFromParts = percentFromRatio(event.partIndex, normalizedParts);
      const percent = percentFromDuration ?? percentFromParts;
      return createProgressData({
        phase: "transcribing",
        text: `${event.service}: transcribing…${percent == null ? "" : ` ${percent}%`}`,
        label: "Transcribing audio",
        percent,
        stepIndex: event.partIndex,
        stepTotal: normalizedParts,
      });
    }
    case ProgressKind.TranscriptDone:
      return createProgressData({
        phase: "transcript",
        text: event.ok
          ? `${event.service}: transcript ready`
          : `${event.service}: transcript unavailable`,
        label: event.ok ? "Transcript ready" : "Transcript unavailable",
        percent: event.ok ? 100 : null,
      });
    case ProgressKind.BirdStart:
      return createProgressData({
        phase: "fetching",
        text: event.client ? `X: extracting tweet (${event.client})…` : "X: extracting tweet…",
        label: "Fetching X post",
      });
    case ProgressKind.BirdDone:
      return createProgressData({
        phase: "fetching",
        text: event.ok ? "X: extracted tweet" : "X: extract failed",
        label: event.ok ? "Fetched X post" : "X extraction failed",
        percent: event.ok ? 100 : null,
      });
    case ProgressKind.NitterStart:
      return createProgressData({
        phase: "fetching",
        text: "X: extracting tweet (nitter)…",
        label: "Fetching X post",
      });
    case ProgressKind.NitterDone:
      return createProgressData({
        phase: "fetching",
        text: event.ok ? "X: extracted tweet" : "X: extract failed",
        label: event.ok ? "Fetched X post" : "X extraction failed",
        percent: event.ok ? 100 : null,
      });
    default:
      return null;
  }
}

export function formatProgress(event: LinkPreviewProgressEvent): string | null {
  return formatProgressEvent(event)?.text ?? null;
}
