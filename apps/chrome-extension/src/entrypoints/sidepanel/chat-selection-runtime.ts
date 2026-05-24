import type { BgToPanel, PanelToBg } from "../../lib/panel-contracts";
import type { ChatSelectedText } from "./chat-image-attachments";

const MAX_SELECTED_TEXT_CHARS = 8_000;
const SELECTION_POLL_INTERVAL_MS = 1_000;
const SELECTION_PREVIEW_CHARS = 220;

type SelectionStateMessage = Extract<BgToPanel, { type: "selection:state" }>;

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sameUrl(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return true;
  return left === right;
}

export function createChatSelectionRuntime(options: {
  rootEl: HTMLElement;
  textEl: HTMLElement;
  clearBtn: HTMLButtonElement;
  sendMessage: (message: PanelToBg) => Promise<void> | void;
  getActiveTabUrl: () => string | null;
  chatEnabled: () => boolean;
}) {
  let selectedText: ChatSelectedText | null = null;
  let ignoredSelectionText: string | null = null;
  let latestRequestId: string | null = null;
  let pending = false;
  let timer: number | null = null;
  let lastActiveUrl: string | null = null;

  function render() {
    options.rootEl.classList.toggle("isHidden", !selectedText);
    if (!selectedText) {
      options.textEl.textContent = "";
      options.rootEl.removeAttribute("title");
      return;
    }
    const normalized = normalizePreviewText(selectedText.text);
    const preview =
      normalized.length > SELECTION_PREVIEW_CHARS
        ? `${normalized.slice(0, SELECTION_PREVIEW_CHARS - 1)}...`
        : normalized;
    options.textEl.textContent = selectedText.truncated ? `${preview} [已截断]` : preview;
    options.rootEl.title = selectedText.text;
  }

  function setSelectedText(next: ChatSelectedText | null) {
    selectedText = next;
    render();
  }

  function shouldRequestSelection() {
    return (
      document.visibilityState === "visible" &&
      options.chatEnabled() &&
      Boolean(options.getActiveTabUrl())
    );
  }

  async function requestSelection() {
    if (pending || !shouldRequestSelection()) {
      if (!options.chatEnabled()) setSelectedText(null);
      return;
    }
    const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    latestRequestId = requestId;
    pending = true;
    try {
      await options.sendMessage({
        type: "panel:get-selection",
        requestId,
        maxChars: MAX_SELECTED_TEXT_CHARS,
      });
    } catch {
      if (latestRequestId === requestId) pending = false;
    }
  }

  function handleSelectionState(message: SelectionStateMessage): boolean {
    if (message.requestId !== latestRequestId) return true;
    pending = false;
    if (!message.ok) {
      setSelectedText(null);
      return true;
    }
    const activeUrl = options.getActiveTabUrl();
    if (!sameUrl(activeUrl, message.url)) return true;
    const text = message.text?.trim() ?? "";
    if (!text) {
      ignoredSelectionText = null;
      setSelectedText(null);
      return true;
    }
    if (ignoredSelectionText === text) {
      setSelectedText(null);
      return true;
    }
    setSelectedText({
      text,
      truncated: Boolean(message.truncated),
      url: message.url ?? null,
      title: message.title ?? null,
    });
    return true;
  }

  options.clearBtn.addEventListener("click", () => {
    ignoredSelectionText = selectedText?.text ?? ignoredSelectionText;
    setSelectedText(null);
  });

  return {
    start() {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        void requestSelection();
      }, SELECTION_POLL_INTERVAL_MS);
      window.addEventListener("focus", () => {
        void requestSelection();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void requestSelection();
      });
      void requestSelection();
    },
    stop() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    },
    handleMessage(message: BgToPanel): boolean {
      if (message.type !== "selection:state") return false;
      return handleSelectionState(message);
    },
    syncActiveTab(url: string | null, chatEnabled: boolean) {
      if (lastActiveUrl !== url) {
        lastActiveUrl = url;
        ignoredSelectionText = null;
        setSelectedText(null);
      }
      if (!chatEnabled) {
        ignoredSelectionText = null;
        setSelectedText(null);
      }
      void requestSelection();
    },
    getSelectedText(): ChatSelectedText | null {
      return selectedText ? { ...selectedText } : null;
    },
    clearAfterSend() {
      ignoredSelectionText = selectedText?.text ?? ignoredSelectionText;
      setSelectedText(null);
    },
    restoreSelectedText(value: ChatSelectedText | null | undefined) {
      ignoredSelectionText = null;
      setSelectedText(value?.text.trim() ? { ...value, text: value.text.trim() } : null);
    },
  };
}
