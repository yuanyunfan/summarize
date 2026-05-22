import { panelUrlsMatch } from "./session-policy";

export type PanelSource = { url: string; title: string | null };

export type NavigationRuntime = {
  markAgentNavigationIntent: (url: string | null | undefined) => void;
  markAgentNavigationResult: (details: unknown) => void;
  getLastAgentNavigationUrl: () => string | null;
  isRecentAgentNavigation: (tabId: number | null, url: string | null) => boolean;
  notePreserveChatForUrl: (url: string | null) => void;
  shouldPreserveChatForRun: (url: string) => boolean;
  syncWithActiveTab: () => Promise<void>;
};

type NavigationRuntimeOptions = {
  ttlMs?: number;
  getCurrentSource: () => PanelSource | null;
  setCurrentSource: (source: PanelSource | null) => void;
  resetForNavigation: (preserveChat: boolean) => void;
  setBaseTitle: (title: string) => void;
};

type AgentNavigation = { url: string; tabId: number | null; at: number };

export function createNavigationRuntime(options: NavigationRuntimeOptions): NavigationRuntime {
  const { ttlMs = 20_000, getCurrentSource, setCurrentSource, setBaseTitle } = options;
  let lastAgentNavigation: AgentNavigation | null = null;
  let pendingPreserveChatForUrl: { url: string; at: number } | null = null;

  const canSyncTabUrl = (url: string | null | undefined): url is string => {
    if (!url) return false;
    if (url.startsWith("chrome://")) return false;
    if (url.startsWith("chrome-extension://")) return false;
    if (url.startsWith("moz-extension://")) return false;
    if (url.startsWith("edge://")) return false;
    if (url.startsWith("about:")) return false;
    return true;
  };

  const isRecentAgentNavigation = (tabId: number | null, url: string | null) => {
    if (!lastAgentNavigation) return false;
    if (Date.now() - lastAgentNavigation.at > ttlMs) {
      lastAgentNavigation = null;
      return false;
    }
    if (tabId != null && lastAgentNavigation.tabId != null && tabId === lastAgentNavigation.tabId) {
      return true;
    }
    if (url && lastAgentNavigation.url && panelUrlsMatch(url, lastAgentNavigation.url)) {
      return true;
    }
    return false;
  };

  const notePreserveChatForUrl = (url: string | null) => {
    if (!url) return;
    pendingPreserveChatForUrl = { url, at: Date.now() };
  };

  const shouldPreserveChatForRun = (url: string) => {
    const pending = pendingPreserveChatForUrl;
    if (pending && Date.now() - pending.at < ttlMs && panelUrlsMatch(url, pending.url)) {
      pendingPreserveChatForUrl = null;
      return true;
    }
    return isRecentAgentNavigation(null, url);
  };

  const syncWithActiveTab = async () => {
    const currentSource = getCurrentSource();
    if (!currentSource) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !canSyncTabUrl(tab.url)) return;
      if (!panelUrlsMatch(tab.url, currentSource.url)) {
        return;
      }
      if (tab.title && tab.title !== currentSource.title) {
        setCurrentSource({ ...currentSource, title: tab.title });
        setBaseTitle(tab.title);
      }
    } catch {
      // ignore
    }
  };

  return {
    markAgentNavigationIntent(url) {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (!trimmed) return;
      lastAgentNavigation = { url: trimmed, tabId: null, at: Date.now() };
    },
    markAgentNavigationResult(details) {
      if (!details || typeof details !== "object") return;
      const obj = details as { finalUrl?: unknown; tabId?: unknown };
      const finalUrl = typeof obj.finalUrl === "string" ? obj.finalUrl.trim() : "";
      const tabId = typeof obj.tabId === "number" ? obj.tabId : null;
      if (!finalUrl && tabId == null) return;
      lastAgentNavigation = {
        url: finalUrl || lastAgentNavigation?.url || "",
        tabId,
        at: Date.now(),
      };
    },
    getLastAgentNavigationUrl() {
      return lastAgentNavigation?.url ?? null;
    },
    isRecentAgentNavigation,
    notePreserveChatForUrl,
    shouldPreserveChatForRun,
    syncWithActiveTab,
  };
}
