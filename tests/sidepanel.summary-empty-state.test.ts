import { describe, expect, it } from "vitest";
import { buildSummaryEmptyState } from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-empty-state.js";

describe("sidepanel summary empty state", () => {
  it("shows a ready state for manual summarize", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: false,
        phase: "idle",
        hasSlides: false,
        progress: null,
      }),
    ).toEqual({
      label: "就绪",
      message: "点击摘要开始。",
      detail: "Example Video",
      progressPercent: null,
      progressActive: false,
    });
  });

  it("shows a loading state when auto summarize is active", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: true,
        phase: "idle",
        hasSlides: false,
        progress: null,
      }),
    ).toEqual({
      label: "加载中",
      message: "正在准备摘要",
      detail: "Example Video",
      progressPercent: null,
      progressActive: true,
    });
  });

  it("does not mask error phase as loading when auto summarize is enabled", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: true,
        phase: "error",
        hasSlides: false,
        progress: null,
      }),
    ).toEqual({
      label: "就绪",
      message: "点击摘要开始。",
      detail: "Example Video",
      progressPercent: null,
      progressActive: false,
    });
  });

  it("shows concrete progress when a running status is available", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: true,
        phase: "streaming",
        hasSlides: false,
        progress: {
          phase: "downloading",
          label: "下载音频",
          message: "正在下载音频",
          detail: "第 1/3 段",
          percent: 42,
          stepIndex: 1,
          stepTotal: 3,
        },
      }),
    ).toEqual({
      label: "下载音频",
      message: "正在下载音频",
      detail: "第 1/3 段 · Example Video",
      progressPercent: 42,
      progressActive: true,
    });
  });

  it("shows a quiet no-page state without extra detail", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: null,
        tabUrl: null,
        autoSummarize: false,
        phase: "idle",
        hasSlides: false,
        progress: null,
      }),
    ).toEqual({
      label: "没有页面",
      message: "打开一个页面后即可摘要。",
      detail: null,
      progressPercent: null,
      progressActive: false,
    });
  });

  it("hides the empty state once slides exist", () => {
    expect(
      buildSummaryEmptyState({
        tabTitle: "Example Video",
        tabUrl: "https://www.youtube.com/watch?v=abc",
        autoSummarize: false,
        phase: "idle",
        hasSlides: true,
        progress: null,
      }),
    ).toBeNull();
  });
});
