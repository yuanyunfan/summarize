import { describe, expect, it } from "vitest";
import {
  buildChatRequestMessages,
  compactChatHistory,
  computeChatContextUsage,
  hasUserChatMessage,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-state";
import type { ChatMessage } from "../apps/chrome-extension/src/entrypoints/sidepanel/types";
import { CHAT_UNUSABLE_ASSISTANT_MESSAGE } from "../src/shared/chat-output-sanitizer.js";

const limits = { maxMessages: 3, maxChars: 10 };

describe("sidepanel/chat-state", () => {
  it("compacts chat history by max messages and chars", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "hello", timestamp: 1 },
      { id: "2", role: "assistant", content: "world", timestamp: 2 },
      { id: "3", role: "user", content: "12345", timestamp: 3 },
      { id: "4", role: "assistant", content: "67890", timestamp: 4 },
    ];

    const compacted = compactChatHistory(messages, limits);
    expect(compacted.map((m) => m.id)).toEqual(["3", "4"]);
  });

  it("computes context usage and user message presence", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", content: "ok", timestamp: 1 },
      { id: "2", role: "user", content: "hi", timestamp: 2 },
    ];

    const usage = computeChatContextUsage(messages, { maxMessages: 100, maxChars: 10 });
    expect(usage.totalChars).toBe(4);
    expect(usage.percent).toBe(40);
    expect(usage.totalMessages).toBe(2);
    expect(hasUserChatMessage(messages)).toBe(true);
  });

  it("builds chat request messages without empty content", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", content: "hi", timestamp: 1 },
      { id: "2", role: "user", content: "", timestamp: 2 },
    ];

    expect(buildChatRequestMessages(messages)).toEqual([{ role: "assistant", content: "hi" }]);
  });

  it("sanitizes leaked assistant protocol artifacts before building request history", () => {
    const messages: ChatMessage[] = [
      {
        id: "1",
        role: "assistant",
        content:
          "<final_answer>\n/workspace/claude/harness/skill-subagent-transform.md:1-200\n</final_answer>",
        timestamp: 1,
      },
    ];

    expect(buildChatRequestMessages(messages)).toEqual([
      { role: "assistant", content: CHAT_UNUSABLE_ASSISTANT_MESSAGE },
    ]);
  });

  it("counts array text and image parts, keeps tool results, and ignores unsupported roles", () => {
    const messages: ChatMessage[] = [
      {
        id: "1",
        role: "system",
        content: "ignore me",
        timestamp: 1,
      } as ChatMessage,
      {
        id: "2",
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "image", data: "image-data", mimeType: "image/png" },
          { type: "text", text: "world" },
        ],
        timestamp: 2,
      } as ChatMessage,
      {
        id: "3",
        role: "toolResult",
        content: "",
        timestamp: 3,
      } as ChatMessage,
    ];

    const usage = computeChatContextUsage(messages, { maxMessages: 10, maxChars: 5 });
    expect(usage.totalChars).toBe(21);
    expect(usage.percent).toBe(100);
    expect(hasUserChatMessage(messages)).toBe(true);
    expect(buildChatRequestMessages(messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "image", data: "image-data", mimeType: "image/png" },
          { type: "text", text: "world" },
        ],
      },
      { role: "toolResult", content: "" },
    ]);
  });

  it("drops empty user messages before compacting", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "", timestamp: 1 },
      { id: "2", role: "assistant", content: "ok", timestamp: 2 },
      { id: "3", role: "user", content: "real", timestamp: 3 },
    ];

    expect(
      compactChatHistory(messages, { maxMessages: 10, maxChars: 100 }).map((m) => m.id),
    ).toEqual(["2", "3"]);
  });
});
