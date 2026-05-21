import { describe, expect, it } from "vitest";
import {
  accumulateChatChunk,
  accumulateSummarizeChunk,
  getTerminalStreamError,
  shouldSurfaceStreamingStatus,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/stream-controller-policy";

describe("sidepanel stream controller policy", () => {
  it("keeps slide status visible during streaming output", () => {
    expect(
      shouldSurfaceStreamingStatus({
        streamedAnyNonWhitespace: true,
        statusText: "slides: extracting frames",
      }),
    ).toBe(true);
    expect(
      shouldSurfaceStreamingStatus({
        streamedAnyNonWhitespace: true,
        statusText: "fetching article",
      }),
    ).toBe(false);
  });

  it("accumulates summarize and chat chunks via pure helpers", () => {
    expect(accumulateChatChunk("Hello", " world")).toBe("Hello world");
    expect(accumulateSummarizeChunk("Hello", " world")).toContain("Hello world");
  });

  it("normalizes terminal stream completion errors", () => {
    expect(
      getTerminalStreamError({ sawDone: false, streamedAnyNonWhitespace: true })?.message,
    ).toBe("流式响应意外结束，daemon 可能已经停止。");
    expect(
      getTerminalStreamError({ sawDone: true, streamedAnyNonWhitespace: false })?.message,
    ).toBe("模型没有返回内容。");
    expect(getTerminalStreamError({ sawDone: true, streamedAnyNonWhitespace: true })).toBeNull();
  });
});
