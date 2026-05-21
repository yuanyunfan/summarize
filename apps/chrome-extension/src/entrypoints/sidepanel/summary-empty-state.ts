import type { PanelPhase } from "./types";

type SummaryEmptyStateInput = {
  tabTitle: string | null;
  tabUrl: string | null;
  autoSummarize: boolean;
  phase: PanelPhase;
  hasSlides: boolean;
};

export type SummaryEmptyState = {
  label: string;
  message: string;
  detail: string | null;
};

export function buildSummaryEmptyState(input: SummaryEmptyStateInput): SummaryEmptyState | null {
  if (input.hasSlides) return null;

  const subject = input.tabTitle?.trim() || input.tabUrl?.trim() || "当前页面";
  if (!input.tabUrl) {
    return {
      label: "没有页面",
      message: "打开一个页面后即可摘要。",
      detail: null,
    };
  }

  if (input.phase === "connecting" || input.phase === "streaming" || input.autoSummarize) {
    return {
      label: "加载中",
      message: "正在准备摘要",
      detail: subject,
    };
  }

  return {
    label: "就绪",
    message: "点击摘要开始。",
    detail: subject,
  };
}
