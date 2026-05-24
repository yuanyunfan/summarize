import type { Message } from "@earendil-works/pi-ai";
import {
  sanitizeChatAssistantContent,
  sanitizeChatAssistantMessage,
} from "../../lib/runtime-contracts";
import { compactChatHistory, type ChatHistoryLimits } from "./chat-state";
import { normalizePanelUrl } from "./session-policy";
import type { ChatMessage } from "./types";

const STORED_IMAGE_DATA_MAX_CHARS = 1_700_000;
const STORED_IMAGE_MIME_PATTERN = /^image\/(?:png|jpeg|webp|gif)$/i;

function getChatHistoryKey(tabId: number, url?: string | null) {
  if (url) {
    try {
      const normalized = normalizePanelUrl(url);
      return `chat:tab:${tabId}:${normalized}`;
    } catch {
      // fall through
    }
  }
  return `chat:tab:${tabId}`;
}

export function buildEmptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function normalizeStoredUserContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") return null;
      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        return { type: "text", text: record.text };
      }
      if (
        record.type === "image" &&
        typeof record.data === "string" &&
        record.data.length <= STORED_IMAGE_DATA_MAX_CHARS &&
        typeof record.mimeType === "string" &&
        STORED_IMAGE_MIME_PATTERN.test(record.mimeType)
      ) {
        return { type: "image", data: record.data, mimeType: record.mimeType.toLowerCase() };
      }
      return null;
    })
    .filter(
      (
        part,
      ): part is
        | { type: "text"; text: string }
        | {
            type: "image";
            data: string;
            mimeType: string;
          } => Boolean(part),
    );
  return parts.length > 0 ? parts : null;
}

export function normalizeStoredMessage(raw: Record<string, unknown>): ChatMessage | null {
  const role = raw.role;
  const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
  const id = typeof raw.id === "string" ? raw.id : crypto.randomUUID();

  if (role === "user") {
    const content = normalizeStoredUserContent(raw.content);
    if (content === null) return null;
    return { ...(raw as Message), role: "user", content, timestamp, id };
  }

  if (role === "assistant") {
    const content = Array.isArray(raw.content)
      ? sanitizeChatAssistantContent(raw.content)
      : typeof raw.content === "string"
        ? [{ type: "text", text: sanitizeChatAssistantContent(raw.content) }]
        : [];
    return {
      ...(raw as Message),
      role: "assistant",
      content,
      api: typeof raw.api === "string" ? raw.api : "openai-completions",
      provider: typeof raw.provider === "string" ? raw.provider : "openai",
      model: typeof raw.model === "string" ? raw.model : "unknown",
      usage: typeof raw.usage === "object" && raw.usage ? raw.usage : buildEmptyUsage(),
      stopReason: typeof raw.stopReason === "string" ? raw.stopReason : "stop",
      timestamp,
      id,
    };
  }

  if (role === "toolResult") {
    const content = Array.isArray(raw.content)
      ? raw.content
      : typeof raw.content === "string"
        ? [{ type: "text", text: raw.content }]
        : [];
    return {
      ...(raw as Message),
      role: "toolResult",
      content,
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : crypto.randomUUID(),
      toolName: typeof raw.toolName === "string" ? raw.toolName : "tool",
      isError: Boolean(raw.isError),
      timestamp,
      id,
    };
  }

  return null;
}

export function createChatHistoryStore({
  chatLimits,
  getStorage = () => chrome.storage?.session,
}: {
  chatLimits: ChatHistoryLimits;
  getStorage?: () => chrome.storage.StorageArea | undefined;
}) {
  const cache = new Map<string, ChatMessage[]>();

  async function clear(tabId: number | null, url?: string | null) {
    if (!tabId) return;
    const key = getChatHistoryKey(tabId, url);
    cache.delete(key);
    const store = getStorage();
    if (!store) return;
    try {
      await store.remove(key);
    } catch {
      // ignore
    }
  }

  async function load(tabId: number, url?: string | null): Promise<ChatMessage[] | null> {
    const key = getChatHistoryKey(tabId, url);
    const cached = cache.get(key);
    if (cached) return cached;
    const store = getStorage();
    if (!store) return null;
    try {
      const res = await store.get(key);
      const raw = res?.[key];
      if (!Array.isArray(raw)) return null;
      const parsed = raw
        .filter((msg) => msg && typeof msg === "object")
        .map((msg) => normalizeStoredMessage(msg as Record<string, unknown>))
        .filter((msg): msg is ChatMessage => Boolean(msg));
      if (!parsed.length) return null;
      cache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async function persist(
    tabId: number | null,
    messages: ChatMessage[],
    chatEnabled: boolean,
    url?: string | null,
  ) {
    if (!chatEnabled || !tabId) return messages;
    const key = getChatHistoryKey(tabId, url);
    const sanitized = messages.map((message) => sanitizeChatAssistantMessage(message));
    const compacted = compactChatHistory(sanitized, chatLimits);
    cache.set(key, compacted);
    const store = getStorage();
    if (!store) return compacted;
    try {
      await store.set({ [key]: compacted });
    } catch {
      // ignore
    }
    return compacted;
  }

  return {
    clear,
    load,
    persist,
  };
}
