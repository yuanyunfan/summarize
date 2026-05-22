import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNavigationRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/navigation-runtime.js";

describe("sidepanel navigation runtime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn(async () => []),
      },
    });
  });

  it("keeps the current summary sticky when the active tab differs", async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { url: "https://example.com/a", title: "A" };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      setCurrentSource: (next) => {
        currentSource = next;
      },
      resetForNavigation,
      setBaseTitle,
    });

    runtime.markAgentNavigationIntent("https://example.com/b");
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 2, url: "https://example.com/b", title: "B" },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toEqual({ url: "https://example.com/a", title: "A" });
    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).not.toHaveBeenCalled();
    expect(runtime.shouldPreserveChatForRun("https://example.com/b")).toBe(true);
  });

  it("updates the current title when the active tab stays on the same page", async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { url: "https://example.com/a", title: "Old" };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      setCurrentSource: (next) => {
        currentSource = next;
      },
      resetForNavigation,
      setBaseTitle,
    });

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 1, url: "https://example.com/a#hash", title: "New" },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toEqual({ url: "https://example.com/a", title: "New" });
    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).toHaveBeenCalledWith("New");
  });

  it("ignores blank navigation intents and malformed results", () => {
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      setCurrentSource: vi.fn(),
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
    });

    runtime.markAgentNavigationIntent("   ");
    runtime.markAgentNavigationResult(null);
    runtime.markAgentNavigationResult({});

    expect(runtime.getLastAgentNavigationUrl()).toBeNull();
  });

  it("preserves chat for matching pending URLs only within ttl", () => {
    vi.useFakeTimers();
    const runtime = createNavigationRuntime({
      ttlMs: 100,
      getCurrentSource: () => null,
      setCurrentSource: vi.fn(),
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
    });

    runtime.notePreserveChatForUrl("https://example.com/next");
    expect(runtime.shouldPreserveChatForRun("https://example.com/next")).toBe(true);
    expect(runtime.shouldPreserveChatForRun("https://example.com/next")).toBe(false);

    runtime.notePreserveChatForUrl("https://example.com/later");
    vi.advanceTimersByTime(101);
    expect(runtime.shouldPreserveChatForRun("https://example.com/later")).toBe(false);
  });

  it("treats matching tab ids as recent agent navigation", () => {
    vi.useFakeTimers();
    const runtime = createNavigationRuntime({
      ttlMs: 100,
      getCurrentSource: () => null,
      setCurrentSource: vi.fn(),
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
    });

    runtime.markAgentNavigationResult({ finalUrl: "https://example.com/final", tabId: 7 });
    expect(runtime.isRecentAgentNavigation(7, null)).toBe(true);
    vi.advanceTimersByTime(101);
    expect(runtime.isRecentAgentNavigation(7, null)).toBe(false);
  });

  it("ignores unsupported active-tab schemes and missing current source", async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      setCurrentSource: vi.fn(),
      resetForNavigation,
      setBaseTitle,
    });

    await runtime.syncWithActiveTab();
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { url: "chrome://extensions", title: "X" },
    ]);

    const runtimeWithSource = createNavigationRuntime({
      getCurrentSource: () => ({ url: "https://example.com/a", title: "A" }),
      setCurrentSource: vi.fn(),
      resetForNavigation,
      setBaseTitle,
    });
    await runtimeWithSource.syncWithActiveTab();

    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).not.toHaveBeenCalled();
  });

  it("does not reset the summary when the active tab changes without agent navigation", async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { url: "https://example.com/a", title: "A" };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      setCurrentSource: (next) => {
        currentSource = next;
      },
      resetForNavigation,
      setBaseTitle,
    });

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 2, url: "https://example.com/b", title: "" },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toEqual({ url: "https://example.com/a", title: "A" });
    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).not.toHaveBeenCalled();
  });

  it("swallows tab-query failures", async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();

    const runtime = createNavigationRuntime({
      getCurrentSource: () => ({ url: "https://example.com/a", title: "A" }),
      setCurrentSource: vi.fn(),
      resetForNavigation,
      setBaseTitle,
    });

    vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error("boom"));
    await expect(runtime.syncWithActiveTab()).resolves.toBeUndefined();
    expect(resetForNavigation).not.toHaveBeenCalled();
  });
});
