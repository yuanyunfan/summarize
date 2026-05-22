import { describe, expect, it } from "vitest";
import {
  assertUsableSummaryMarkdown,
  isClassificationOnlySummary,
  sanitizeSummaryMarkdown,
} from "../src/shared/summary-sanitizer.js";

describe("summary sanitizer", () => {
  it("removes final_answer protocol tags from markdown", () => {
    const input = [
      "<final_answer> <final_answer>",
      "### Key moments",
      "- [0:10] Intro",
      "</final_answer>",
    ].join("\n");

    expect(sanitizeSummaryMarkdown(input)).toBe("### Key moments\n- [0:10] Intro");
  });

  it("removes malformed final_answer protocol marker fragments", () => {
    const input = ["final_answer> final_answer>", "### Key moments", "- [0:10] Intro"].join("\n");

    expect(sanitizeSummaryMarkdown(input)).toBe("### Key moments\n- [0:10] Intro");
  });

  it("does not alter fenced code examples", () => {
    const input = ["```xml", "<final_answer>", "body", "</final_answer>", "```"].join("\n");

    expect(sanitizeSummaryMarkdown(input)).toBe(input);
  });

  it("detects classification-only outputs", () => {
    const input = [
      "系统/架构设计：否",
      "算法/研究论文：否",
      "工程实践/经验总结：是",
      "概念综述/行业分析：是",
    ].join("\n");

    expect(isClassificationOnlySummary(input)).toBe(true);
    expect(() => assertUsableSummaryMarkdown(input)).toThrow(/classification labels/);
  });

  it("detects classification-only outputs wrapped in final_answer tags", () => {
    const input = ["<final_answer>", "系统/架构设计", "</final_answer>"].join("\n");

    expect(isClassificationOnlySummary(input)).toBe(true);
    expect(() => assertUsableSummaryMarkdown(input)).toThrow(/classification labels/);
  });

  it("detects classification-only custom prompt sections", () => {
    expect(isClassificationOnlySummary("类型：工程实践/经验总结")).toBe(true);
    expect(
      isClassificationOnlySummary(["判断文章类型>", "系统/架构设计", "</判断文章类型>"].join("\n")),
    ).toBe(true);
  });

  it("allows real summaries that mention classifications", () => {
    const input = [
      "### 文章类型",
      "工程实践/经验总结：是",
      "",
      "这篇文章分析 GitHub 可用性和容量规划问题，重点解释服务可靠性下降的原因。",
    ].join("\n");

    expect(isClassificationOnlySummary(input)).toBe(false);
    expect(() => assertUsableSummaryMarkdown(input)).not.toThrow();
  });
});
