import type { SummaryProgress } from "./summary-progress";
import type { PanelPhase } from "./types";

type SummaryEmptyStateInput = {
  tabTitle: string | null;
  tabUrl: string | null;
  autoSummarize: boolean;
  phase: PanelPhase;
  hasSlides: boolean;
  progress: SummaryProgress | null;
};

export type SummaryEmptyState = {
  label: string;
  message: string;
  detail: string | null;
  progressPercent: number | null;
  progressActive: boolean;
};

export function buildSummaryEmptyState(input: SummaryEmptyStateInput): SummaryEmptyState | null {
  if (input.hasSlides) return null;

  const subject = input.tabTitle?.trim() || input.tabUrl?.trim() || "当前页面";
  if (!input.tabUrl) {
    return {
      label: "没有页面",
      message: "打开一个页面后即可摘要。",
      detail: null,
      progressPercent: null,
      progressActive: false,
    };
  }

  if (input.phase === "connecting" || input.phase === "streaming") {
    const progress = input.progress;
    const progressDetail =
      progress?.detail && progress.detail.trim().length > 0
        ? `${progress.detail} · ${subject}`
        : subject;
    return {
      label: progress?.label ?? "加载中",
      message: progress?.message ?? "正在准备摘要",
      detail: progressDetail,
      progressPercent: progress?.percent ?? null,
      progressActive: true,
    };
  }

  return {
    label: "就绪",
    message: "点击摘要开始。",
    detail: subject,
    progressPercent: null,
    progressActive: false,
  };
}
