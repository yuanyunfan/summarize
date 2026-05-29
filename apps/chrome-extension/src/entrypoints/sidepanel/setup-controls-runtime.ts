import { createDrawerControls } from "./drawer-controls";
import { createModelPresetsController } from "./model-presets";
import { createSetupRuntime } from "./setup-runtime";

export function createSetupControlsRuntime({
  advancedSettingsBodyEl,
  advancedSettingsEl,
  defaultModel,
  drawerEl,
  drawerToggleBtn,
  generateToken,
  getStatusResetText,
  headerSetStatus,
  loadSettings,
  modelPresetEl,
  modelStatusEl,
  patchSettings,
  setupEl,
}: {
  advancedSettingsBodyEl: HTMLDivElement;
  advancedSettingsEl: HTMLDetailsElement;
  defaultModel: string;
  drawerEl: HTMLDivElement;
  drawerToggleBtn: HTMLButtonElement;
  generateToken: () => string;
  getStatusResetText: () => string;
  headerSetStatus: (text: string) => void;
  loadSettings: () => Promise<{ token: string }>;
  modelPresetEl: HTMLSelectElement;
  modelStatusEl: HTMLSpanElement;
  patchSettings: (patch: Record<string, unknown>) => Promise<unknown>;
  setupEl: HTMLDivElement;
}) {
  const modelPresetsController = createModelPresetsController({
    modelPresetEl,
    modelStatusEl,
    defaultModel,
    loadSettings,
  });

  const drawerControls = createDrawerControls({
    drawerEl,
    drawerToggleBtn,
    advancedSettingsEl,
    advancedSettingsBodyEl,
    refreshModelsIfStale: modelPresetsController.refreshIfStale,
  });

  const ensureToken = async (): Promise<string> => {
    const settings = await loadSettings();
    if (settings.token.trim()) return settings.token.trim();
    const token = generateToken();
    await patchSettings({ token });
    return token;
  };

  const setupRuntime = createSetupRuntime({
    setupEl,
    loadToken: async () => (await loadSettings()).token.trim(),
    ensureToken,
    patchSettings,
    generateToken,
    headerSetStatus,
    getStatusResetText,
  });

  return {
    drawerControls,
    maybeShowSetup: setupRuntime.maybeShowSetup,
    readCurrentModelValue: modelPresetsController.readCurrentValue,
    refreshModelPresets: modelPresetsController.refreshPresets,
    refreshModelsIfStale: modelPresetsController.refreshIfStale,
    refreshModelsNow: modelPresetsController.refreshNow,
    setDefaultModelPresets: modelPresetsController.setDefaultPresets,
    setModelStatus: modelPresetsController.setStatus,
    setModelValue: modelPresetsController.setValue,
  };
}
