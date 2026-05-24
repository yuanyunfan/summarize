import { describe, expect, it } from "vitest";
import {
  CHAT_UNUSABLE_ASSISTANT_MESSAGE,
  isPathOnlyChatReference,
  sanitizeChatAssistantText,
} from "../src/shared/chat-output-sanitizer.js";

describe("chat output sanitizer", () => {
  it("strips leaked final_answer protocol wrappers around useful text", () => {
    expect(sanitizeChatAssistantText("<final_answer>\n这是可用回答。\n</final_answer>")).toBe(
      "这是可用回答。",
    );
  });

  it("replaces path-only internal references with a usable fallback", () => {
    const leaked = [
      "<final_answer>",
      "/workspace/claude/harness/skill-subagent-transform.md:1-200",
      "</final_answer>",
    ].join("\n");

    expect(isPathOnlyChatReference(leaked)).toBe(true);
    expect(sanitizeChatAssistantText(leaked)).toBe(CHAT_UNUSABLE_ASSISTANT_MESSAGE);
    expect(sanitizeChatAssistantText(leaked, { final: false })).toBe("");
  });

  it("preserves final_answer examples inside fenced code", () => {
    const markdown = ["```xml", "<final_answer>", "body", "</final_answer>", "```"].join("\n");

    expect(sanitizeChatAssistantText(markdown)).toBe(markdown);
  });
});
