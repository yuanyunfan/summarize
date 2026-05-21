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
      }),
    ).toEqual({
      label: "就绪",
      message: "点击摘要开始。",
      detail: "Example Video",
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
      }),
    ).toEqual({
      label: "加载中",
      message: "正在准备摘要",
      detail: "Example Video",
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
      }),
    ).toEqual({
      label: "没有页面",
      message: "打开一个页面后即可摘要。",
      detail: null,
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
      }),
    ).toBeNull();
  });
});
