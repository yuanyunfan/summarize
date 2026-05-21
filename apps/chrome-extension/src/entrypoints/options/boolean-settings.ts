import type { defaultSettings } from "../../lib/settings";
import { createBooleanToggleController } from "./toggles";

type BooleanSettingsState = {
  autoSummarize: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  hoverSummaries: boolean;
  summaryTimestamps: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  extendedLogging: boolean;
  autoCliFallback: boolean;
};

type ToggleController = {
  render: () => void;
};

export function createBooleanSettingsRuntime(options: {
  defaults: typeof defaultSettings;
  roots: {
    autoToggleRoot: HTMLElement;
    chatToggleRoot: HTMLElement;
    automationToggleRoot: HTMLElement;
    hoverSummariesToggleRoot: HTMLElement;
    summaryTimestampsToggleRoot: HTMLElement;
    slidesParallelToggleRoot: HTMLElement;
    slidesOcrToggleRoot: HTMLElement;
    extendedLoggingToggleRoot: HTMLElement;
    autoCliFallbackToggleRoot: HTMLElement;
  };
  scheduleAutoSave: (delayMs?: number) => void;
  onAutomationChanged?: () => void;
}) {
  const state: BooleanSettingsState = {
    autoSummarize: options.defaults.autoSummarize,
    chatEnabled: options.defaults.chatEnabled,
    automationEnabled: options.defaults.automationEnabled,
    hoverSummaries: options.defaults.hoverSummaries,
    summaryTimestamps: options.defaults.summaryTimestamps,
    slidesParallel: options.defaults.slidesParallel,
    slidesOcrEnabled: options.defaults.slidesOcrEnabled,
    extendedLogging: options.defaults.extendedLogging,
    autoCliFallback: options.defaults.autoCliFallback,
  };

  const toggles: ToggleController[] = [
    createBooleanToggleController({
      root: options.roots.autoToggleRoot,
      id: "options-auto",
      label: "打开侧边栏时自动摘要",
      getValue: () => state.autoSummarize,
      setValue: (checked) => {
        state.autoSummarize = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.chatToggleRoot,
      id: "options-chat",
      label: "启用侧边栏 Chat 模式",
      getValue: () => state.chatEnabled,
      setValue: (checked) => {
        state.chatEnabled = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.automationToggleRoot,
      id: "options-automation",
      label: "启用网页自动化",
      getValue: () => state.automationEnabled,
      setValue: (checked) => {
        state.automationEnabled = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
      afterChange: options.onAutomationChanged,
    }),
    createBooleanToggleController({
      root: options.roots.hoverSummariesToggleRoot,
      id: "options-hover-summaries",
      label: "悬停摘要（实验性）",
      getValue: () => state.hoverSummaries,
      setValue: (checked) => {
        state.hoverSummaries = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.summaryTimestampsToggleRoot,
      id: "options-summary-timestamps",
      label: "摘要时间戳（仅媒体）",
      getValue: () => state.summaryTimestamps,
      setValue: (checked) => {
        state.summaryTimestamps = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.slidesParallelToggleRoot,
      id: "options-slides-parallel",
      label: "优先显示摘要（并行提取 slides）",
      getValue: () => state.slidesParallel,
      setValue: (checked) => {
        state.slidesParallel = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.slidesOcrToggleRoot,
      id: "options-slides-ocr",
      label: "启用 slide OCR 文本",
      getValue: () => state.slidesOcrEnabled,
      setValue: (checked) => {
        state.slidesOcrEnabled = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.extendedLoggingToggleRoot,
      id: "options-extended-logging",
      label: "扩展日志",
      getValue: () => state.extendedLogging,
      setValue: (checked) => {
        state.extendedLogging = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
    createBooleanToggleController({
      root: options.roots.autoCliFallbackToggleRoot,
      id: "options-auto-cli-fallback",
      label: "自动 CLI fallback",
      getValue: () => state.autoCliFallback,
      setValue: (checked) => {
        state.autoCliFallback = checked;
      },
      scheduleAutoSave: options.scheduleAutoSave,
    }),
  ];

  return {
    getState: () => ({ ...state }),
    setState: (next: Partial<BooleanSettingsState>) => {
      Object.assign(state, next);
    },
    render: () => {
      for (const toggle of toggles) toggle.render();
    },
  };
}
