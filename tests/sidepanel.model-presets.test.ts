// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelPresetsController } from "../apps/chrome-extension/src/entrypoints/sidepanel/model-presets.js";
import type { Settings } from "../apps/chrome-extension/src/lib/settings.js";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flushAsyncWork = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const createController = () => {
  const modelPresetEl = document.createElement("select");
  const modelStatusEl = document.createElement("div");
  const controller = createModelPresetsController({
    modelPresetEl,
    modelStatusEl,
    defaultModel: "auto",
    loadSettings: async () => ({ token: "token" }) as Settings,
  });
  controller.setDefaultPresets();
  return { controller, modelPresetEl };
};

describe("sidepanel model presets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an out-of-list value selected via a transient option", () => {
    const { controller, modelPresetEl } = createController();
    controller.setValue("openai/user-choice");
    expect(controller.readCurrentValue()).toBe("openai/user-choice");
    expect(modelPresetEl.value).toBe("openai/user-choice");
    const option = Array.from(modelPresetEl.options).find((o) => o.value === "openai/user-choice");
    expect(option?.dataset.transient).toBe("true");
  });

  it("preserves a user selection made while refresh is pending", async () => {
    const refresh = createDeferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => refresh.promise),
    );
    const { controller, modelPresetEl } = createController();

    const refreshPromise = controller.refreshPresets("token");
    controller.setValue("openai/user-choice");

    refresh.resolve(
      jsonResponse({
        ok: true,
        providers: { openai: true },
        options: [{ id: "openai/from-refresh", label: "From refresh" }],
      }),
    );
    await refreshPromise;
    await flushAsyncWork();

    // The discovered option is present, and the user's mid-flight choice is kept.
    expect(Array.from(modelPresetEl.options).map((o) => o.value)).toContain("openai/from-refresh");
    expect(controller.readCurrentValue()).toBe("openai/user-choice");
    expect(modelPresetEl.value).toBe("openai/user-choice");
  });

  it("lists discovered models directly as options", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          options: [
            { id: "copilot/gpt-5.5", label: "Copilot: gpt-5.5" },
            { id: "copilot/claude-opus-4.8", label: "Copilot: claude-opus-4.8" },
          ],
        }),
      ),
    );
    const { controller, modelPresetEl } = createController();
    await controller.refreshPresets("token");
    await flushAsyncWork();

    const values = Array.from(modelPresetEl.options).map((o) => o.value);
    expect(values).toContain("copilot/gpt-5.5");
    expect(values).toContain("copilot/claude-opus-4.8");
    // Baseline options remain.
    expect(values).toContain("auto");
    // No custom sentinel option anymore.
    expect(values).not.toContain("custom");
  });

  it("filters options to the selected account's provider prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          options: [
            { id: "copilot/gpt-5.5", label: "Copilot: gpt-5.5" },
            { id: "copilot/claude-opus-4.8", label: "Copilot: claude-opus-4.8" },
            { id: "openai/gpt-4o", label: "OpenAI: GPT-4o" },
            { id: "anthropic/claude-3-haiku", label: "Anthropic" },
          ],
        }),
      ),
    );
    const { controller, modelPresetEl } = createController();
    await controller.refreshPresets("token");
    await flushAsyncWork();

    // No filter → everything is shown plus general presets.
    let values = Array.from(modelPresetEl.options).map((o) => o.value);
    expect(values).toContain("openai/gpt-4o");
    expect(values).toContain("free");

    // Filter to Copilot → only copilot/* + universal `auto`, no env-key models.
    controller.setProviderFilter("copilot/");
    values = Array.from(modelPresetEl.options).map((o) => o.value);
    expect(values).toContain("auto");
    expect(values).toContain("copilot/gpt-5.5");
    expect(values).toContain("copilot/claude-opus-4.8");
    expect(values).not.toContain("openai/gpt-4o");
    expect(values).not.toContain("anthropic/claude-3-haiku");
    expect(values).not.toContain("free");
    expect(values).not.toContain("gpt-fast");

    // Clearing the filter restores the full list.
    controller.setProviderFilter(null);
    values = Array.from(modelPresetEl.options).map((o) => o.value);
    expect(values).toContain("openai/gpt-4o");
    expect(values).toContain("free");
  });

  it("ignores older token results that resolve after a newer refresh", async () => {
    const oldRefresh = createDeferred<Response>();
    const newRefresh = createDeferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const token = String(new Headers(init?.headers).get("Authorization") ?? "");
        if (token.endsWith("old")) return oldRefresh.promise;
        if (token.endsWith("new")) return newRefresh.promise;
        throw new Error(`unexpected token: ${token}`);
      }),
    );
    const { controller, modelPresetEl } = createController();

    const oldPromise = controller.refreshPresets("old");
    const newPromise = controller.refreshPresets("new");

    newRefresh.resolve(
      jsonResponse({
        ok: true,
        options: [{ id: "new/model", label: "New model" }],
      }),
    );
    await newPromise;
    oldRefresh.resolve(
      jsonResponse({
        ok: true,
        options: [{ id: "old/model", label: "Old model" }],
      }),
    );
    await oldPromise;
    await flushAsyncWork();

    expect(Array.from(modelPresetEl.options).map((option) => option.value)).toContain("new/model");
    expect(Array.from(modelPresetEl.options).map((option) => option.value)).not.toContain(
      "old/model",
    );
  });
});
