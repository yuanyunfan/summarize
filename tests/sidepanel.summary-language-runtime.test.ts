// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSummaryLanguageRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-language-runtime.js";

const flushAsyncWork = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

describe("sidepanel summary language runtime", () => {
  it("renders language presets and refreshes summary when the user changes language", async () => {
    const selectEl = document.createElement("select");
    let language = "auto";
    const loadSettings = vi.fn(async () => ({ language }));
    const patchSettings = vi.fn(async (patch: { language?: string }) => {
      language = patch.language ?? language;
    });
    const sendSummarize = vi.fn();

    const runtime = createSummaryLanguageRuntime({
      selectEl,
      loadSettings,
      patchSettings,
      sendSummarize,
    });

    runtime.bind();
    await runtime.refresh();

    expect(selectEl.value).toBe("auto");
    expect(Array.from(selectEl.options).map((option) => option.textContent)).toContain(
      "中文（简体）",
    );

    selectEl.value = "zh-cn";
    selectEl.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(patchSettings).toHaveBeenCalledWith({ language: "zh-cn" });
    expect(selectEl.value).toBe("zh-cn");
    expect(sendSummarize).toHaveBeenCalledWith({ refresh: true });
  });

  it("keeps a saved custom language visible", async () => {
    const selectEl = document.createElement("select");
    const runtime = createSummaryLanguageRuntime({
      selectEl,
      loadSettings: async () => ({ language: "Portuguese (Brazil)" }),
      patchSettings: vi.fn(),
      sendSummarize: vi.fn(),
    });

    await runtime.refresh();

    expect(selectEl.value).toBe("Portuguese (Brazil)");
    expect(selectEl.selectedOptions[0]?.textContent).toBe("自定义：Portuguese (Brazil)");
  });
});
