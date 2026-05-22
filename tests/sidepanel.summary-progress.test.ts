import { describe, expect, it } from "vitest";
import {
  buildSummaryProgressFromSse,
  buildSummaryProgressFromStatus,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-progress.js";

describe("sidepanel summary progress", () => {
  it("localizes status text into concrete summary progress", () => {
    expect(buildSummaryProgressFromStatus("Connecting…", "connecting")).toMatchObject({
      phase: "connecting",
      label: "连接服务",
      message: "正在连接 daemon",
      percent: null,
    });

    expect(
      buildSummaryProgressFromStatus("youtube: downloading audio… 42%", "streaming"),
    ).toMatchObject({
      phase: "downloading",
      label: "下载音频",
      message: "正在下载音频",
      percent: 42,
    });
  });

  it("preserves structured percent and step detail from SSE progress", () => {
    expect(
      buildSummaryProgressFromSse({
        phase: "transcribing",
        text: "youtube: transcribing… 67%",
        label: "Transcribing audio",
        detail: null,
        percent: 67,
        stepIndex: 2,
        stepTotal: 3,
      }),
    ).toEqual({
      phase: "transcribing",
      label: "转写音频",
      message: "正在转写音频",
      detail: "第 2/3 段",
      percent: 67,
      stepIndex: 2,
      stepTotal: 3,
    });
  });
});
