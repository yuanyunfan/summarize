import type { Settings } from "../../lib/settings";

type StatusState = "idle" | "running" | "error" | "ok";

type LoadSettings = () => Promise<Pick<Settings, "token">>;

/**
 * Single-dropdown model selector. The dropdown is the only model control: it
 * lists the models the daemon reports for the current credentials/logins
 * (`GET /v1/models`), so it stays in sync with the Accounts section above it.
 *
 * A saved model that isn't in the current list (e.g. a manually-configured id,
 * or a provider that just logged out) is preserved as a transient option so the
 * selection never silently changes underneath the user.
 */
export function createModelPresetsController({
  modelPresetEl,
  modelStatusEl,
  defaultModel,
  loadSettings,
}: {
  modelPresetEl: HTMLSelectElement;
  modelStatusEl: HTMLElement;
  defaultModel: string;
  loadSettings: LoadSettings;
}) {
  let refreshAt = 0;

  const setStatus = (text: string, state: StatusState = "idle") => {
    modelStatusEl.textContent = text;
    if (state === "idle") {
      modelStatusEl.removeAttribute("data-state");
    } else {
      modelStatusEl.setAttribute("data-state", state);
    }
  };

  // Baseline options always available regardless of login state.
  const baseOptions: Array<{ value: string; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "gpt-fast", label: "GPT Fast" },
    { value: "free", label: "Free" },
  ];

  const setDefaultPresets = () => {
    modelPresetEl.innerHTML = "";
    for (const { value, label } of baseOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modelPresetEl.append(option);
    }
  };

  const optionValues = () => new Set(Array.from(modelPresetEl.options).map((o) => o.value));

  /**
   * Ensure `value` exists as an option (adding a transient one if needed) and
   * select it. Keeps an out-of-list saved model visible instead of resetting.
   */
  const setValue = (value: string) => {
    const next = value.trim() || defaultModel;
    if (!optionValues().has(next)) {
      const el = document.createElement("option");
      el.value = next;
      el.textContent = next;
      el.dataset.transient = "true";
      modelPresetEl.append(el);
    }
    modelPresetEl.value = next;
  };

  const readCurrentValue = () => modelPresetEl.value.trim() || defaultModel;

  let refreshRequestId = 0;
  const refreshPresets = async (token: string) => {
    const requestId = ++refreshRequestId;
    const isCurrentRequest = () => requestId === refreshRequestId;
    const trimmed = token.trim();

    const rebuild = (options: Array<{ id: string; label: string }>) => {
      // Read the selection at rebuild time (after the await) so a choice the
      // user made while the request was in flight is preserved.
      const selected = readCurrentValue();
      setDefaultPresets();
      const seen = optionValues();
      for (const option of options) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        const el = document.createElement("option");
        el.value = option.id;
        el.textContent = option.label ? `${option.id} — ${option.label}` : option.id;
        modelPresetEl.append(el);
      }
      // Preserve the prior selection (adds a transient option if it's gone).
      setValue(selected);
    };

    if (!trimmed) {
      rebuild([]);
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:8787/v1/models", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!isCurrentRequest()) return;
      if (!response.ok) {
        rebuild([]);
        return;
      }
      const json = (await response.json()) as unknown;
      if (!isCurrentRequest()) return;
      if (!json || typeof json !== "object") return;
      const record = json as Record<string, unknown>;
      if (record.ok !== true) return;

      const optionsRaw = record.options;
      const options = Array.isArray(optionsRaw)
        ? optionsRaw
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const option = item as { id?: unknown; label?: unknown };
              const id = typeof option.id === "string" ? option.id.trim() : "";
              const label = typeof option.label === "string" ? option.label.trim() : "";
              if (!id) return null;
              return { id, label };
            })
            .filter((item): item is { id: string; label: string } => item !== null)
        : [];
      rebuild(options);
    } catch {
      // Daemon unreachable: keep whatever is currently shown.
    }
  };

  const refreshIfStale = () => {
    const now = Date.now();
    if (now - refreshAt < 1500) return;
    refreshAt = now;
    void (async () => {
      const token = (await loadSettings()).token;
      await refreshPresets(token);
    })();
  };

  /** Force a refresh now (e.g. right after a login/logout changes availability). */
  const refreshNow = () => {
    refreshAt = Date.now();
    void (async () => {
      const token = (await loadSettings()).token;
      await refreshPresets(token);
    })();
  };

  return {
    readCurrentValue,
    refreshIfStale,
    refreshNow,
    refreshPresets,
    setDefaultPresets,
    setStatus,
    setValue,
  };
}
