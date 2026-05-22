import { describe, expect, it, vi } from "vitest";
import { bindBackgroundListeners } from "../apps/chrome-extension/src/entrypoints/background/listeners";

function installChromeListenerStubs() {
  const onMessage = { addListener: vi.fn() };
  const onUserScriptMessage = { addListener: vi.fn() };
  const chromeStub = {
    runtime: {
      onConnect: { addListener: vi.fn() },
      onMessage,
      onUserScriptMessage,
    },
    storage: { onChanged: { addListener: vi.fn() } },
    webNavigation: { onHistoryStateUpdated: { addListener: vi.fn() } },
    tabs: {
      get: vi.fn(),
      onActivated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return { onMessage, onUserScriptMessage, chromeStub };
}

describe("background userScripts runtime messages", () => {
  it("routes userScripts messages through runtime actions", () => {
    const { onUserScriptMessage } = installChromeListenerStubs();
    const runtimeActionsHandler = vi.fn(() => true);
    const hoverRuntimeHandler = vi.fn(() => false);

    bindBackgroundListeners({
      panelSessionStore: {
        registerPanelSession: vi.fn(),
        deletePanelSession: vi.fn(),
        getPanelSession: vi.fn(() => null),
        getPanelSessions: vi.fn(() => []),
        clearCachedExtractsForWindow: vi.fn(async () => undefined),
        clearTab: vi.fn(),
      },
      handlePanelMessage: vi.fn(),
      onPanelDisconnect: vi.fn(),
      runtimeActionsHandler,
      hoverRuntimeHandler,
      emitState: vi.fn(),
      onTabRemoved: vi.fn(),
    });

    const listener = onUserScriptMessage.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    const sendResponse = vi.fn();
    const result = listener?.(
      { type: "automation:artifacts", action: "listArtifacts" },
      { tab: { id: 123 } },
      sendResponse,
    );

    expect(result).toBe(true);
    expect(runtimeActionsHandler).toHaveBeenCalledWith(
      { type: "automation:artifacts", action: "listArtifacts" },
      { tab: { id: 123 } },
      sendResponse,
    );
    expect(hoverRuntimeHandler).not.toHaveBeenCalled();
  });
});

describe("background navigation listeners", () => {
  it("updates panel state without auto summarizing when the active tab changes", () => {
    const { chromeStub } = installChromeListenerStubs();
    const session = { lastNavAt: 0 };
    const emitState = vi.fn();

    bindBackgroundListeners({
      panelSessionStore: {
        registerPanelSession: vi.fn(),
        deletePanelSession: vi.fn(),
        getPanelSession: vi.fn(() => session),
        getPanelSessions: vi.fn(() => []),
        clearCachedExtractsForWindow: vi.fn(async () => undefined),
        clearTab: vi.fn(),
      },
      handlePanelMessage: vi.fn(),
      onPanelDisconnect: vi.fn(),
      runtimeActionsHandler: vi.fn(),
      hoverRuntimeHandler: vi.fn(),
      emitState,
      onTabRemoved: vi.fn(),
    });

    const listener = chromeStub.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    listener?.({ windowId: 1, tabId: 7 });

    expect(emitState).toHaveBeenCalledWith(session, "");
  });

  it("updates panel state without auto summarizing on tab URL and load changes", () => {
    const { chromeStub } = installChromeListenerStubs();
    const session = { lastNavAt: 0 };
    const emitState = vi.fn();

    bindBackgroundListeners({
      panelSessionStore: {
        registerPanelSession: vi.fn(),
        deletePanelSession: vi.fn(),
        getPanelSession: vi.fn(() => session),
        getPanelSessions: vi.fn(() => []),
        clearCachedExtractsForWindow: vi.fn(async () => undefined),
        clearTab: vi.fn(),
      },
      handlePanelMessage: vi.fn(),
      onPanelDisconnect: vi.fn(),
      runtimeActionsHandler: vi.fn(),
      hoverRuntimeHandler: vi.fn(),
      emitState,
      onTabRemoved: vi.fn(),
    });

    const listener = chromeStub.tabs.onUpdated.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    listener?.(7, { url: "https://example.com/next" }, { windowId: 1 });
    listener?.(7, { status: "complete" }, { windowId: 1 });

    expect(emitState).toHaveBeenCalledWith(session, "");
  });

  it("updates panel state without auto summarizing on SPA navigation", async () => {
    const { chromeStub } = installChromeListenerStubs();
    const session = { lastNavAt: 0 };
    const emitState = vi.fn();
    chromeStub.tabs.get.mockResolvedValue({ windowId: 1 });

    bindBackgroundListeners({
      panelSessionStore: {
        registerPanelSession: vi.fn(),
        deletePanelSession: vi.fn(),
        getPanelSession: vi.fn(() => session),
        getPanelSessions: vi.fn(() => []),
        clearCachedExtractsForWindow: vi.fn(async () => undefined),
        clearTab: vi.fn(),
      },
      handlePanelMessage: vi.fn(),
      onPanelDisconnect: vi.fn(),
      runtimeActionsHandler: vi.fn(),
      hoverRuntimeHandler: vi.fn(),
      emitState,
      onTabRemoved: vi.fn(),
    });

    const listener = chromeStub.webNavigation.onHistoryStateUpdated.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    listener?.({ tabId: 7 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitState).toHaveBeenCalledWith(session, "");
  });
});
