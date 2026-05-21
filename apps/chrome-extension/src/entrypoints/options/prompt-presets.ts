import { createCustomPromptId, type CustomPrompt, type Settings } from "../../lib/settings";

type PromptPresetsElements = {
  presetEl: HTMLSelectElement;
  nameEl: HTMLInputElement;
  promptEl: HTMLTextAreaElement;
  newBtn: HTMLButtonElement;
  saveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  metaEl: HTMLElement;
};

function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

function derivePromptName(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "新 Prompt";
  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
}

export function createPromptPresetsController({
  elements,
  scheduleAutoSave,
  flashStatus,
}: {
  elements: PromptPresetsElements;
  scheduleAutoSave: (delay?: number) => void;
  flashStatus: (text: string, duration?: number) => void;
}) {
  let customPrompts: CustomPrompt[] = [];
  let selectedPromptId = "";
  let adHocPrompt = "";
  let isApplying = false;

  const selectedPrompt = () =>
    customPrompts.find((prompt) => prompt.id === selectedPromptId) ?? null;

  const normalizeSelection = () => {
    if (selectedPrompt()) return;
    selectedPromptId = "";
  };

  const renderPresetOptions = () => {
    normalizeSelection();
    elements.presetEl.textContent = "";
    elements.presetEl.append(option("", adHocPrompt.trim() ? "临时 Prompt" : "默认 Prompt"));
    for (const prompt of customPrompts) {
      elements.presetEl.append(option(prompt.id, prompt.name));
    }
    elements.presetEl.value = selectedPromptId;
  };

  const renderEditor = () => {
    const prompt = selectedPrompt();
    isApplying = true;
    elements.nameEl.disabled = !prompt;
    elements.deleteBtn.disabled = !prompt;
    elements.saveBtn.textContent = prompt ? "更新 Prompt" : "保存为 Prompt";
    elements.nameEl.value = prompt?.name ?? "";
    elements.promptEl.value = prompt?.prompt ?? adHocPrompt;
    elements.metaEl.textContent = `已保存 ${customPrompts.length} 个 Prompt`;
    isApplying = false;
  };

  const render = () => {
    renderPresetOptions();
    renderEditor();
  };

  const upsertSelectedFromEditor = () => {
    const prompt = selectedPrompt();
    if (!prompt) {
      adHocPrompt = elements.promptEl.value;
      return;
    }
    prompt.name = elements.nameEl.value.trim() || derivePromptName(elements.promptEl.value);
    prompt.prompt = elements.promptEl.value;
    prompt.updatedAt = Date.now();
    renderPresetOptions();
  };

  const createPromptFromEditor = () => {
    const promptText = elements.promptEl.value;
    const prompt: CustomPrompt = {
      id: createCustomPromptId(),
      name: elements.nameEl.value.trim() || derivePromptName(promptText),
      prompt: promptText,
      updatedAt: Date.now(),
    };
    customPrompts = [prompt, ...customPrompts].slice(0, 50);
    selectedPromptId = prompt.id;
    render();
    scheduleAutoSave(200);
    elements.nameEl.focus();
    flashStatus("Prompt 已保存");
  };

  const bind = () => {
    elements.presetEl.addEventListener("change", () => {
      upsertSelectedFromEditor();
      selectedPromptId = elements.presetEl.value;
      render();
      scheduleAutoSave(200);
    });

    elements.promptEl.addEventListener("input", () => {
      if (isApplying) return;
      upsertSelectedFromEditor();
      scheduleAutoSave(600);
    });

    elements.nameEl.addEventListener("input", () => {
      if (isApplying) return;
      upsertSelectedFromEditor();
      scheduleAutoSave(400);
    });

    elements.newBtn.addEventListener("click", () => {
      upsertSelectedFromEditor();
      createPromptFromEditor();
    });

    elements.saveBtn.addEventListener("click", () => {
      upsertSelectedFromEditor();
      if (!selectedPrompt()) {
        createPromptFromEditor();
        return;
      }
      render();
      scheduleAutoSave(200);
      flashStatus("Prompt 已更新");
    });

    elements.deleteBtn.addEventListener("click", () => {
      const current = selectedPrompt();
      if (!current) return;
      customPrompts = customPrompts.filter((prompt) => prompt.id !== current.id);
      selectedPromptId = "";
      render();
      scheduleAutoSave(200);
      flashStatus("Prompt 已删除");
    });
  };

  const applySettings = (settings: Settings) => {
    customPrompts = settings.customPrompts.map((prompt) => ({ ...prompt }));
    selectedPromptId = settings.selectedPromptId;
    adHocPrompt = settings.promptOverride;
    render();
  };

  return {
    bind,
    applySettings,
    readCustomPrompts: () => customPrompts.map((prompt) => ({ ...prompt })),
    readSelectedPromptId: () => (selectedPrompt() ? selectedPromptId : ""),
    readPromptOverride: () => (selectedPrompt() ? adHocPrompt : elements.promptEl.value),
  };
}
