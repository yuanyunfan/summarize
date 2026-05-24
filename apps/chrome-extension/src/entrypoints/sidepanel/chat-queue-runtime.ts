import {
  chatPayloadHasContent,
  formatChatPayloadPreview,
  normalizeChatInputPayload,
  type ChatInputPayload,
} from "./chat-image-attachments";

type ChatQueueItem = {
  id: string;
  payload: ChatInputPayload;
  createdAt: number;
};

type ChatQueueRuntimeOpts = {
  chatQueueEl: HTMLElement;
  maxQueue: number;
  setStatus: (value: string) => void;
};

export function createChatQueueRuntime(opts: ChatQueueRuntimeOpts) {
  let queue: ChatQueueItem[] = [];

  function normalizeQueuePayload(input: ChatInputPayload) {
    const payload = normalizeChatInputPayload(input);
    payload.text = payload.text.replace(/\s+/g, " ").trim();
    return chatPayloadHasContent(payload) ? payload : null;
  }

  function removeQueuedMessage(id: string) {
    queue = queue.filter((item) => item.id !== id);
    renderChatQueue();
  }

  function renderChatQueue() {
    if (queue.length === 0) {
      opts.chatQueueEl.classList.add("isHidden");
      opts.chatQueueEl.replaceChildren();
      return;
    }
    opts.chatQueueEl.classList.remove("isHidden");
    opts.chatQueueEl.replaceChildren();

    for (const item of queue) {
      const row = document.createElement("div");
      row.className = "chatQueueItem";
      row.dataset.id = item.id;

      const text = document.createElement("div");
      text.className = "chatQueueText";
      const preview = formatChatPayloadPreview(item.payload);
      text.textContent = preview;
      text.title = preview;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chatQueueRemove";
      remove.textContent = "x";
      remove.setAttribute("aria-label", "移除排队消息");
      remove.addEventListener("click", () => removeQueuedMessage(item.id));

      row.append(text, remove);
      opts.chatQueueEl.append(row);
    }
  }

  function enqueueChatMessage(input: ChatInputPayload): boolean {
    const payload = normalizeQueuePayload(input);
    if (!payload) return false;
    if (queue.length >= opts.maxQueue) {
      opts.setStatus(`队列已满（${opts.maxQueue}）。先移除一条再添加。`);
      return false;
    }
    queue.push({ id: crypto.randomUUID(), payload, createdAt: Date.now() });
    renderChatQueue();
    return true;
  }

  function clearQueuedMessages() {
    if (queue.length === 0) return;
    queue = [];
    renderChatQueue();
  }

  function dequeueQueuedMessage() {
    return queue.shift();
  }

  return {
    clearQueuedMessages,
    dequeueQueuedMessage,
    enqueueChatMessage,
    getQueueLength: () => queue.length,
    renderChatQueue,
  };
}
