import { describe, expect, it } from "vitest";
import {
  buildEmptyUsage,
  createChatHistoryStore,
  normalizeStoredMessage,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-history-store.js";
import type { ChatMessage } from "../apps/chrome-extension/src/entrypoints/sidepanel/types.js";
import { CHAT_UNUSABLE_ASSISTANT_MESSAGE } from "../src/shared/chat-output-sanitizer.js";

function createMemoryStorage(): chrome.storage.StorageArea {
  const values = new Map<string, unknown>();
  return {
    get: async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (typeof keys === "string") return { [keys]: values.get(keys) };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, values.get(key)]));
      }
      return Object.fromEntries(values.entries());
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    clear: async () => values.clear(),
  } as chrome.storage.StorageArea;
}

describe("sidepanel chat history store", () => {
  it("normalizes stored user messages with image parts", () => {
    expect(
      normalizeStoredMessage({
        id: "user-1",
        role: "user",
        timestamp: 1,
        content: [
          { type: "text", text: "look" },
          { type: "image", data: "abc123", mimeType: "IMAGE/PNG" },
          { type: "image", data: "x".repeat(1_700_001), mimeType: "image/png" },
          { type: "image", data: "abc123", mimeType: "image/bmp" },
          { type: "unknown" },
          null,
        ],
      }),
    ).toMatchObject({
      id: "user-1",
      role: "user",
      timestamp: 1,
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "abc123", mimeType: "image/png" },
      ],
    });

    expect(normalizeStoredMessage({ role: "user", content: [] })).toBeNull();
    expect(normalizeStoredMessage({ role: "user", content: 42 })).toBeNull();
  });

  it("normalizes assistant and tool result messages with defaults", () => {
    const assistant = normalizeStoredMessage({
      role: "assistant",
      content: "hello",
    });
    expect(assistant).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "openai-completions",
      provider: "openai",
      model: "unknown",
      usage: buildEmptyUsage(),
      stopReason: "stop",
    });
    expect(typeof assistant?.id).toBe("string");
    expect(typeof assistant?.timestamp).toBe("number");

    const toolResult = normalizeStoredMessage({
      role: "toolResult",
      content: "raw output",
    });
    expect(toolResult).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: "raw output" }],
      toolName: "tool",
      isError: false,
    });
    expect(typeof (toolResult as { toolCallId?: unknown } | null)?.toolCallId).toBe("string");
    expect(normalizeStoredMessage({ role: "system", content: "ignore" })).toBeNull();
  });

  it("isolates cached history by tab and normalized URL", async () => {
    const storage = createMemoryStorage();
    const store = createChatHistoryStore({
      chatLimits: { maxMessages: 10, maxChars: 1_000 },
      getStorage: () => storage,
    });
    const pageA: ChatMessage = { id: "a", role: "user", content: "page a", timestamp: 1 };
    const pageB: ChatMessage = { id: "b", role: "user", content: "page b", timestamp: 2 };

    await store.persist(7, [pageA], true, "https://example.com/a#first");
    await store.persist(7, [pageB], true, "https://example.com/b");

    await expect(store.load(7, "https://example.com/a#second")).resolves.toEqual([pageA]);
    await expect(store.load(7, "https://example.com/b")).resolves.toEqual([pageB]);
  });

  it("clears only the current URL history for a tab", async () => {
    const storage = createMemoryStorage();
    const store = createChatHistoryStore({
      chatLimits: { maxMessages: 10, maxChars: 1_000 },
      getStorage: () => storage,
    });
    const pageA: ChatMessage = { id: "a", role: "user", content: "page a", timestamp: 1 };
    const pageB: ChatMessage = { id: "b", role: "user", content: "page b", timestamp: 2 };

    await store.persist(7, [pageA], true, "https://example.com/a");
    await store.persist(7, [pageB], true, "https://example.com/b");
    await store.clear(7, "https://example.com/a");

    await expect(store.load(7, "https://example.com/a")).resolves.toBeNull();
    await expect(store.load(7, "https://example.com/b")).resolves.toEqual([pageB]);
  });

  it("sanitizes leaked assistant protocol artifacts before persisting history", async () => {
    const storage = createMemoryStorage();
    const store = createChatHistoryStore({
      chatLimits: { maxMessages: 10, maxChars: 1_000 },
      getStorage: () => storage,
    });
    const leaked: ChatMessage = {
      id: "leak",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "<final_answer>\n/workspace/claude/harness/skill-subagent-transform.md:1-200\n</final_answer>",
        },
      ],
      timestamp: 1,
    } as ChatMessage;

    const persisted = await store.persist(7, [leaked], true, "https://example.com/a");
    await expect(store.load(7, "https://example.com/a")).resolves.toEqual(persisted);
    expect(persisted[0]?.content).toEqual([
      { type: "text", text: CHAT_UNUSABLE_ASSISTANT_MESSAGE },
    ]);
  });

  it("handles disabled storage, disabled chat, and storage failures", async () => {
    const message: ChatMessage = { id: "u", role: "user", content: "hello", timestamp: 1 };
    const noStorageStore = createChatHistoryStore({
      chatLimits: { maxMessages: 10, maxChars: 1_000 },
      getStorage: () => undefined,
    });
    await expect(noStorageStore.load(1, "https://example.com")).resolves.toBeNull();
    await expect(
      noStorageStore.persist(1, [message], true, "https://example.com"),
    ).resolves.toEqual([message]);
    await expect(
      noStorageStore.persist(1, [message], false, "https://example.com"),
    ).resolves.toEqual([message]);
    await expect(
      noStorageStore.persist(null, [message], true, "https://example.com"),
    ).resolves.toEqual([message]);
    await expect(noStorageStore.clear(null, "https://example.com")).resolves.toBeUndefined();

    const throwingStorage = {
      get: async () => {
        throw new Error("get failed");
      },
      set: async () => {
        throw new Error("set failed");
      },
      remove: async () => {
        throw new Error("remove failed");
      },
    } as unknown as chrome.storage.StorageArea;
    const throwingStore = createChatHistoryStore({
      chatLimits: { maxMessages: 10, maxChars: 1_000 },
      getStorage: () => throwingStorage,
    });
    await expect(throwingStore.load(1, "https://example.com")).resolves.toBeNull();
    await expect(throwingStore.persist(1, [message], true, "https://example.com")).resolves.toEqual(
      [message],
    );
    await expect(throwingStore.clear(1, "https://example.com")).resolves.toBeUndefined();
  });
});
