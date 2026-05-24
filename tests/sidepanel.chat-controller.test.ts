// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatController,
  type ChatControllerOptions,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-controller";
import { setMermaidRuntimeLoaderForTest } from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-renderer.js";
import type { ChatMessage } from "../apps/chrome-extension/src/entrypoints/sidepanel/types";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({
    svg: `<svg id="${id}" role="img"><text>diagram</text></svg>`,
  })),
}));

function createController() {
  const messagesEl = document.createElement("div");
  const inputEl = document.createElement("textarea");
  const sendBtn = document.createElement("button");
  const contextEl = document.createElement("div");
  document.body.append(messagesEl, inputEl, sendBtn, contextEl);
  return {
    controller: new ChatController({
      messagesEl,
      inputEl,
      sendBtn,
      contextEl,
      markdown: { render: renderMarkdown } as ChatControllerOptions["markdown"],
      limits: { maxMessages: 1000, maxChars: 160_000 },
    }),
    messagesEl,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(value: string): string {
  const fence = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fence) {
    return `<pre><code>${escapeHtml(fence[1] ?? "")}</code></pre>`;
  }
  return `<p>${escapeHtml(value)}</p>`;
}

describe("sidepanel chat controller", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg role="img"><text>diagram</text></svg>',
    });
    setMermaidRuntimeLoaderForTest(async () => ({
      initialize: mermaidMocks.initialize,
      render: mermaidMocks.render,
    }));
  });

  afterEach(() => {
    setMermaidRuntimeLoaderForTest(null);
  });

  it("renders assistant Mermaid code blocks as diagrams", async () => {
    const { controller, messagesEl } = createController();
    const message: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "```\ngraph TD\nA[1.0] --> B[2.0]\n```",
      timestamp: Date.now(),
    } as ChatMessage;

    controller.addMessage(message);

    await vi.waitFor(() => {
      expect(messagesEl.querySelector(".renderMermaid svg")).not.toBeNull();
    });

    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^summary-mermaid-/),
      "graph TD\nA[1.0] --> B[2.0]",
    );
    expect(messagesEl.querySelector("pre > code")).toBeNull();
  });

  it("renders user image attachments as thumbnails", () => {
    const { controller, messagesEl } = createController();
    const message: ChatMessage = {
      id: "user-1",
      role: "user",
      content: [
        { type: "text", text: "Look at this" },
        { type: "image", data: "abc123", mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    } as ChatMessage;

    controller.addMessage(message);

    expect(messagesEl.querySelector(".chatMessageText")?.textContent).toBe("Look at this");
    const image = messagesEl.querySelector<HTMLImageElement>(".chatImageThumb");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,abc123");
  });
});
