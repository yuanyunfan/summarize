import type { SseProgressData, SseProgressPhase } from "../../lib/runtime-contracts";
import { splitStatusPercent } from "../../lib/status";
import type { PanelPhase } from "./types";

export type SummaryProgress = {
  phase: SseProgressPhase | "preparing";
  label: string;
  message: string;
  detail: string | null;
  percent: number | null;
  stepIndex: number | null;
  stepTotal: number | null;
};

type LocalizedProgress = Pick<SummaryProgress, "label" | "message">;

function clampPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function percentFromStatus(text: string): number | null {
  const { percent } = splitStatusPercent(text);
  if (!percent) return null;
  return clampPercent(Number.parseInt(percent, 10));
}

function normalizeStep(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function buildStepDetail(stepIndex: number | null, stepTotal: number | null): string | null {
  if (stepIndex == null || stepTotal == null || stepTotal <= 1) return null;
  return `第 ${Math.min(stepIndex, stepTotal)}/${stepTotal} 段`;
}

function localizeProgress(phase: SummaryProgress["phase"], text: string): LocalizedProgress {
  const normalized = text.trim().toLowerCase();
  if (phase === "downloading") {
    return { label: "下载音频", message: "正在下载音频" };
  }
  if (phase === "transcribing") {
    return { label: "转写音频", message: "正在转写音频" };
  }
  if (phase === "transcript") {
    if (normalized.includes("unavailable")) {
      return { label: "字幕不可用", message: "未获取到可用字幕，继续读取页面内容" };
    }
    if (normalized.includes("ready")) {
      return { label: "字幕已就绪", message: "字幕已获取，正在准备摘要" };
    }
    return { label: "获取字幕", message: "正在获取视频字幕" };
  }
  if (phase === "fetching") {
    if (normalized.includes("firecrawl")) {
      return { label: "网页抓取", message: "正在抓取网页内容" };
    }
    if (normalized.includes("x:")) {
      return { label: "获取 X 内容", message: "正在读取 X 内容" };
    }
    return { label: "获取内容", message: "正在读取远程内容" };
  }
  if (phase === "extracting") {
    return { label: "提取内容", message: "正在提取页面内容" };
  }
  if (phase === "connecting") {
    return { label: "连接服务", message: "正在连接 daemon" };
  }
  if (phase === "summarizing") {
    return { label: "生成摘要", message: "正在生成摘要" };
  }
  if (phase === "slides") {
    return { label: "生成预览", message: "正在提取视频画面" };
  }
  if (phase === "fallback") {
    return { label: "切换模型", message: "主模型失败，正在尝试 fallback" };
  }
  return { label: "准备摘要", message: "正在准备摘要" };
}

function phaseFromStatus(text: string, panelPhase: PanelPhase): SummaryProgress["phase"] | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;
  if (lower.startsWith("error:") || lower.startsWith("错误：")) return null;
  if (lower === "copied" || lower === "已复制" || lower === "复制失败") return null;
  if (lower.includes("primary failed") || lower.includes("fallback")) return "fallback";
  if (lower.includes("slide")) return "slides";
  if (lower.includes("downloading") || lower.includes("下载")) return "downloading";
  if (lower.includes("transcribing") || lower.includes("whisper") || lower.includes("转写")) {
    return "transcribing";
  }
  if (
    lower.includes("transcript") ||
    lower.includes("caption") ||
    lower.includes("字幕") ||
    lower.includes("captions")
  ) {
    return "transcript";
  }
  if (lower.includes("firecrawl") || lower.startsWith("fetching") || lower.includes("读取远程")) {
    return "fetching";
  }
  if (lower.startsWith("extracting") || lower.includes("extract:") || lower.includes("提取")) {
    return "extracting";
  }
  if (lower.startsWith("connecting") || lower.includes("正在连接")) return "connecting";
  if (lower.startsWith("summarizing") || lower.includes("正在摘要") || lower.includes("生成摘要")) {
    return "summarizing";
  }
  if (panelPhase === "connecting") return "connecting";
  if (panelPhase === "streaming") return "summarizing";
  return null;
}

export function buildSummaryProgressFromStatus(
  text: string,
  panelPhase: PanelPhase,
): SummaryProgress | null {
  const trimmed = text.trim();
  const phase = phaseFromStatus(trimmed, panelPhase);
  if (!phase) return null;
  const localized = localizeProgress(phase, trimmed);
  return {
    phase,
    ...localized,
    detail: null,
    percent: percentFromStatus(trimmed),
    stepIndex: null,
    stepTotal: null,
  };
}

export function buildSummaryProgressFromSse(data: SseProgressData): SummaryProgress {
  const stepIndex = normalizeStep(data.stepIndex);
  const stepTotal = normalizeStep(data.stepTotal);
  const localized = localizeProgress(data.phase, data.text || data.label);
  return {
    phase: data.phase,
    ...localized,
    detail: buildStepDetail(stepIndex, stepTotal),
    percent: clampPercent(data.percent) ?? percentFromStatus(data.text),
    stepIndex,
    stepTotal,
  };
}
