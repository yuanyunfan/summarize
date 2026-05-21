import type { CustomPrompt, Settings } from "../../lib/settings";

type SummaryPromptSettings = Pick<
  Settings,
  "customPrompts" | "promptOverride" | "selectedPromptId"
>;

function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

function hasPromptId(prompts: CustomPrompt[], id: string): boolean {
  return prompts.some((prompt) => prompt.id === id);
}

export function createSummaryPromptRuntime({
  rootEl,
  selectEl,
  optionsBtn,
  loadSettings,
  patchSettings,
  openOptions,
  sendSummarize,
}: {
  rootEl: HTMLElement;
  selectEl: HTMLSelectElement;
  optionsBtn: HTMLButtonElement;
  loadSettings: () => Promise<SummaryPromptSettings>;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  openOptions: () => Promise<void>;
  sendSummarize: (opts?: { refresh?: boolean }) => void;
}) {
  let isRendering = false;

  const render = (settings: SummaryPromptSettings) => {
    const selectedId = hasPromptId(settings.customPrompts, settings.selectedPromptId)
      ? settings.selectedPromptId
      : "";
    isRendering = true;
    selectEl.textContent = "";
    selectEl.append(option("", settings.promptOverride.trim() ? "临时 Prompt" : "默认 Prompt"));
    for (const prompt of settings.customPrompts) {
      selectEl.append(option(prompt.id, prompt.name));
    }
    selectEl.value = selectedId;
    rootEl.classList.remove("hidden");
    isRendering = false;
  };

  const refresh = async () => {
    render(await loadSettings());
  };

  const bind = () => {
    selectEl.addEventListener("change", () => {
      if (isRendering) return;
      const selectedPromptId = selectEl.value;
      void (async () => {
        await patchSettings({ selectedPromptId });
        await refresh();
        sendSummarize({ refresh: true });
      })();
    });

    optionsBtn.addEventListener("click", () => {
      void openOptions();
    });

    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;
      void refresh();
    });
  };

  return { bind, refresh };
}
