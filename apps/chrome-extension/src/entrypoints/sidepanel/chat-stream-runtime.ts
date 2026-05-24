import {
  chatPayloadHasContent,
  normalizeChatInputPayload,
  type ChatInputPayload,
} from "./chat-image-attachments";

type ChatStreamRuntimeOpts = {
  chatEnabled: () => boolean;
  isChatStreaming: () => boolean;
  setChatStreaming: (value: boolean) => void;
  hasUserMessages: () => boolean;
  addUserMessage: (payload: ChatInputPayload) => void;
  dequeueQueuedMessage: () => { payload: ChatInputPayload } | undefined;
  getQueuedChatCount: () => number;
  renderChatQueue: () => void;
  focusInput: () => void;
  clearErrors: () => void;
  resetAbort: () => void;
  metricsSetChatMode: () => void;
  setLastActionChat: () => void;
  scrollToBottom: (force?: boolean) => void;
  persistChatHistory: () => void | Promise<void>;
  setStatus: (value: string) => void;
  showInlineError: (message: string) => void;
  executeAgentLoop: () => Promise<void>;
};

export function createChatStreamRuntime(opts: ChatStreamRuntimeOpts) {
  function finishStreamingMessage() {
    opts.setChatStreaming(false);
    opts.focusInput();
    void opts.persistChatHistory();
    maybeSendQueuedChat();
  }

  function startChatMessage(payload: ChatInputPayload) {
    const input = normalizeChatInputPayload(payload);
    if (!chatPayloadHasContent(input) || !opts.chatEnabled()) return;

    opts.clearErrors();
    opts.resetAbort();
    opts.addUserMessage(input);
    opts.setChatStreaming(true);
    opts.metricsSetChatMode();
    opts.setLastActionChat();
    opts.scrollToBottom(true);

    void (async () => {
      try {
        await opts.executeAgentLoop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.setStatus(`错误：${message}`);
        opts.showInlineError(message);
      } finally {
        finishStreamingMessage();
      }
    })();
  }

  function maybeSendQueuedChat() {
    if (opts.isChatStreaming() || !opts.chatEnabled()) return;
    if (opts.getQueuedChatCount() === 0) {
      opts.renderChatQueue();
      return;
    }
    const next = opts.dequeueQueuedMessage();
    opts.renderChatQueue();
    if (next) startChatMessage(next.payload);
  }

  function retryChat() {
    if (!opts.chatEnabled() || opts.isChatStreaming()) return;
    if (!opts.hasUserMessages()) return;

    opts.clearErrors();
    opts.resetAbort();
    opts.setChatStreaming(true);
    opts.metricsSetChatMode();
    opts.setLastActionChat();
    opts.scrollToBottom(true);

    void (async () => {
      try {
        await opts.executeAgentLoop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.setStatus(`错误：${message}`);
        opts.showInlineError(message);
      } finally {
        finishStreamingMessage();
      }
    })();
  }

  return {
    finishStreamingMessage,
    maybeSendQueuedChat,
    retryChat,
    startChatMessage,
  };
}
