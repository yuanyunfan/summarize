// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatSelectionRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-selection-runtime";
import type { PanelToBg } from "../apps/chrome-extension/src/lib/panel-contracts";

function createHarness() {
  const rootEl = document.createElement("div");
  rootEl.className = "isHidden";
  const textEl = document.createElement("span");
  const clearBtn = document.createElement("button");
  rootEl.append(textEl, clearBtn);
  document.body.append(rootEl);
  const sent: PanelToBg[] = [];
  const runtime = createChatSelectionRuntime({
    rootEl,
    textEl,
    clearBtn,
    sendMessage: vi.fn(async (message: PanelToBg) => {
      sent.push(message);
    }),
    getActiveTabUrl: () => "https://example.com/article",
    chatEnabled: () => true,
  });
  return { runtime, rootEl, textEl, clearBtn, sent };
}

describe("chat selection runtime", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("requests active-tab selection and renders the selected text preview", async () => {
    const harness = createHarness();

    harness.runtime.syncActiveTab("https://example.com/article", true);
    await Promise.resolve();
    const request = harness.sent[0];
    expect(request).toMatchObject({ type: "panel:get-selection", maxChars: 8000 });
    if (request?.type !== "panel:get-selection") throw new Error("missing selection request");

    expect(
      harness.runtime.handleMessage({
        type: "selection:state",
        requestId: request.requestId,
        ok: true,
        text: "Selected text from the active page",
        truncated: false,
        url: "https://example.com/article",
        title: "Article",
      }),
    ).toBe(true);

    expect(harness.rootEl.classList.contains("isHidden")).toBe(false);
    expect(harness.textEl.textContent).toContain("Selected text from the active page");
    expect(harness.runtime.getSelectedText()).toEqual({
      text: "Selected text from the active page",
      truncated: false,
      url: "https://example.com/article",
      title: "Article",
    });
  });

  it("lets the user ignore the current selection until it changes", async () => {
    const harness = createHarness();
    harness.runtime.syncActiveTab("https://example.com/article", true);
    await Promise.resolve();
    const request = harness.sent[0];
    if (request?.type !== "panel:get-selection") throw new Error("missing selection request");

    harness.runtime.handleMessage({
      type: "selection:state",
      requestId: request.requestId,
      ok: true,
      text: "Selected text",
      truncated: false,
      url: "https://example.com/article",
      title: "Article",
    });
    harness.clearBtn.click();
    expect(harness.rootEl.classList.contains("isHidden")).toBe(true);

    harness.runtime.handleMessage({
      type: "selection:state",
      requestId: request.requestId,
      ok: true,
      text: "Selected text",
      truncated: false,
      url: "https://example.com/article",
      title: "Article",
    });
    expect(harness.rootEl.classList.contains("isHidden")).toBe(true);

    harness.runtime.handleMessage({
      type: "selection:state",
      requestId: request.requestId,
      ok: true,
      text: "Changed selected text",
      truncated: false,
      url: "https://example.com/article",
      title: "Article",
    });
    expect(harness.rootEl.classList.contains("isHidden")).toBe(false);
    expect(harness.textEl.textContent).toContain("Changed selected text");
  });
});
