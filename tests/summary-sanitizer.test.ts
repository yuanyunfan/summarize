import { describe, expect, it } from "vitest";
import { sanitizeSummaryMarkdown } from "../src/shared/summary-sanitizer.js";

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

  it("does not alter fenced code examples", () => {
    const input = ["```xml", "<final_answer>", "body", "</final_answer>", "```"].join("\n");

    expect(sanitizeSummaryMarkdown(input)).toBe(input);
  });
});
