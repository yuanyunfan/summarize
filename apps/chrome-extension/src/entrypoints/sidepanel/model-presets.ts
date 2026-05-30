import type { Settings } from "../../lib/settings";

type StatusState = "idle" | "running" | "error" | "ok";

type LoadSettings = () => Promise<Pick<Settings, "token">>;

type ModelOption = { id: string; label: string };

/**
 * Single-dropdown model selector. The dropdown is the only model control: it
 * lists the models the daemon reports for the current credentials/logins
 * (`GET /v1/models`), so it stays in sync with the Accounts section above it.
 *
 * When an account (login method) is selected above, the list is filtered to
 * just that account's models via {@link setProviderFilter} — e.g. selecting
 * "GitHub Copilot" shows only `copilot/*` models. With no filter the full list
 * is shown.
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
  /** Last full option list from the daemon, kept so we can re-filter instantly. */
  let lastOptions: ModelOption[] = [];
  /** When set, only models whose id starts with this prefix are shown. */
  let providerFilter: string | null = null;

  const setStatus = (text: string, state: StatusState = "idle") => {
    modelStatusEl.textContent = text;
    if (state === "idle") {
      modelStatusEl.removeAttribute("data-state");
    } else {
      modelStatusEl.setAttribute("data-state", state);
    }
  };

  // Baseline options. `auto` is universal; `gpt-fast`/`free` are only relevant
  // when no specific account is selected.
  const universalOptions: Array<{ value: string; label: string }> = [
    { value: "auto", label: "自动" },
  ];
  const generalOnlyOptions: Array<{ value: string; label: string }> = [
    { value: "gpt-fast", label: "GPT Fast" },
    { value: "free", label: "Free" },
  ];

  const setDefaultPresets = () => {
    modelPresetEl.innerHTML = "";
    const base = providerFilter ? universalOptions : [...universalOptions, ...generalOnlyOptions];
    for (const { value, label } of base) {
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

  /** Rebuild the dropdown from {@link lastOptions} applying the current filter. */
  const applyOptions = () => {
    // Read the selection now so a choice made while a request was in flight,
    // or before the filter changed, is preserved.
    const selected = readCurrentValue();
    setDefaultPresets();
    const seen = optionValues();
    for (const option of lastOptions) {
      if (providerFilter && !option.id.startsWith(providerFilter)) continue;
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      const el = document.createElement("option");
      el.value = option.id;
      el.textContent = option.label ? `${option.id} — ${option.label}` : option.id;
      modelPresetEl.append(el);
    }
    // Preserve the prior selection (adds a transient option if it's filtered out).
    setValue(selected);
  };

  /**
   * Filter the list to a single provider's models (by id prefix), or pass null
   * to show everything. Re-applies immediately against the cached options.
   */
  const setProviderFilter = (prefix: string | null) => {
    providerFilter = prefix && prefix.trim() ? prefix.trim() : null;
    applyOptions();
  };

  let refreshRequestId = 0;
  const refreshPresets = async (token: string) => {
    const requestId = ++refreshRequestId;
    const isCurrentRequest = () => requestId === refreshRequestId;
    const trimmed = token.trim();

    if (!trimmed) {
      lastOptions = [];
      applyOptions();
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:8787/v1/models", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!isCurrentRequest()) return;
      if (!response.ok) {
        lastOptions = [];
        applyOptions();
        return;
      }
      const json = (await response.json()) as unknown;
      if (!isCurrentRequest()) return;
      if (!json || typeof json !== "object") return;
      const record = json as Record<string, unknown>;
      if (record.ok !== true) return;

      const optionsRaw = record.options;
      lastOptions = Array.isArray(optionsRaw)
        ? optionsRaw
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const option = item as { id?: unknown; label?: unknown };
              const id = typeof option.id === "string" ? option.id.trim() : "";
              const label = typeof option.label === "string" ? option.label.trim() : "";
              if (!id) return null;
              return { id, label };
            })
            .filter((item): item is ModelOption => item !== null)
        : [];
      applyOptions();
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
    setProviderFilter,
    setStatus,
    setValue,
  };
}
