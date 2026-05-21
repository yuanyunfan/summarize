import { getLanguageLabel, languageOptions } from "../../lib/language-options";
import type { Settings } from "../../lib/settings";

type SummaryLanguageSettings = Pick<Settings, "language">;

function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

function renderLanguageOptions(selectEl: HTMLSelectElement, value: string) {
  selectEl.textContent = "";
  for (const language of languageOptions) {
    selectEl.append(option(language.value, language.label));
  }
  if (value && !languageOptions.some((language) => language.value === value)) {
    selectEl.append(option(value, `自定义：${getLanguageLabel(value)}`));
  }
  selectEl.value = value || "auto";
}

export function createSummaryLanguageRuntime({
  selectEl,
  loadSettings,
  patchSettings,
  sendSummarize,
}: {
  selectEl: HTMLSelectElement;
  loadSettings: () => Promise<SummaryLanguageSettings>;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  sendSummarize: (opts?: { refresh?: boolean }) => void;
}) {
  let isRendering = false;

  const render = (settings: SummaryLanguageSettings) => {
    isRendering = true;
    renderLanguageOptions(selectEl, settings.language);
    isRendering = false;
  };

  const refresh = async () => {
    render(await loadSettings());
  };

  const bind = () => {
    selectEl.addEventListener("change", () => {
      if (isRendering) return;
      const language = selectEl.value || "auto";
      void (async () => {
        await patchSettings({ language });
        await refresh();
        sendSummarize({ refresh: true });
      })();
    });

    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;
      void refresh();
    });
  };

  return { bind, refresh, render };
}
