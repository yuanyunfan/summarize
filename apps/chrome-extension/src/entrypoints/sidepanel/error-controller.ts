type ErrorControllerOptions = {
  panelEl: HTMLElement;
  panelMessageEl: HTMLElement;
  panelRetryBtn?: HTMLButtonElement | null;
  panelLogsBtn?: HTMLButtonElement | null;
  inlineEl: HTMLElement;
  inlineMessageEl: HTMLElement;
  inlineRetryBtn?: HTMLButtonElement | null;
  inlineLogsBtn?: HTMLButtonElement | null;
  inlineCloseBtn?: HTMLButtonElement | null;
  onRetry?: () => void;
  onOpenLogs?: () => void;
  onPanelVisibilityChange?: () => void;
};

export type ErrorController = {
  showPanelError: (message: string) => void;
  showInlineError: (message: string) => void;
  clearPanelError: () => void;
  clearInlineError: () => void;
  clearAll: () => void;
};

const stripInvisible = (message: string) => message.replace(/[\u200B-\u200D\uFEFF]/g, "");

const hasMeaningfulMessage = (message: string) =>
  stripInvisible(message).replace(/\s/g, "").length > 0;

const normalizeMessage = (message: string) => {
  const trimmed = stripInvisible(message).trim();
  return trimmed.length > 0 ? trimmed : "出错了。";
};

export const createErrorController = (options: ErrorControllerOptions): ErrorController => {
  const {
    panelEl,
    panelMessageEl,
    panelRetryBtn,
    panelLogsBtn,
    inlineEl,
    inlineMessageEl,
    inlineRetryBtn,
    inlineLogsBtn,
    inlineCloseBtn,
    onRetry,
    onOpenLogs,
    onPanelVisibilityChange,
  } = options;

  const hideInline = () => {
    inlineMessageEl.textContent = "";
    inlineEl.classList.add("hidden");
    inlineEl.style.display = "none";
  };

  const hidePanel = () => {
    panelMessageEl.textContent = "";
    panelEl.classList.add("hidden");
    onPanelVisibilityChange?.();
  };

  const showPanel = (message: string) => {
    if (!hasMeaningfulMessage(message)) {
      hidePanel();
      return;
    }
    hideInline();
    panelMessageEl.textContent = normalizeMessage(message);
    panelEl.classList.remove("hidden");
    onPanelVisibilityChange?.();
  };

  const showInline = (message: string) => {
    if (!hasMeaningfulMessage(message)) {
      hideInline();
      return;
    }
    hidePanel();
    inlineMessageEl.textContent = normalizeMessage(message);
    inlineEl.classList.remove("hidden");
    inlineEl.style.display = "";
  };

  panelRetryBtn?.addEventListener("click", () => onRetry?.());
  panelLogsBtn?.addEventListener("click", () => onOpenLogs?.());
  inlineRetryBtn?.addEventListener("click", () => onRetry?.());
  inlineLogsBtn?.addEventListener("click", () => onOpenLogs?.());
  inlineCloseBtn?.addEventListener("click", () => hideInline());

  return {
    showPanelError: showPanel,
    showInlineError: showInline,
    clearPanelError: hidePanel,
    clearInlineError: hideInline,
    clearAll: () => {
      hidePanel();
      hideInline();
    },
  };
};
