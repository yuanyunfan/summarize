import { bindSettingsStorage, bindSidepanelLifecycle } from "./bindings";

type LoadedSettings = {
  autoSummarize: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  slidesLayout: string;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  model: string;
  token: string;
};

export function bootstrapSidepanel(options: {
  ensurePanelPort: () => Promise<void>;
  loadSettings: () => Promise<LoadedSettings>;
  getPendingSettingsSnapshot: () => Partial<LoadedSettings> | null;
  clearPendingSettingsSnapshot: () => void;
  setSettingsHydrated: (value: boolean) => void;
  typographyController: {
    setCurrentFontSize: (value: number) => void;
    setCurrentLineHeight: (value: number) => void;
  };
  setAutoValue: (value: boolean) => void;
  setChatEnabledValue: (value: boolean) => void;
  setAutomationEnabledValue: (value: boolean) => void;
  setSlidesLayoutValue: (value: string) => void;
  setSlidesLayoutInputValue: (value: string) => void;
  hideAutomationNotice: () => void;
  appearanceControls: {
    setAutoValue: (value: boolean) => void;
    initializeFromSettings: (settings: LoadedSettings) => void;
  };
  applyChatEnabled: () => void;
  applySlidesLayout: () => void;
  setDefaultModelPresets: () => void;
  setModelValue: (value: string) => void;
  toggleDrawerClosed: () => void;
  renderMarkdownDisplay: () => void;
  sendReady: () => void;
  scheduleAutoKick: () => void;
  sendPing: () => void;
  bindSettingsStorage: Parameters<typeof bindSettingsStorage>[0];
  bindSidepanelLifecycle: Parameters<typeof bindSidepanelLifecycle>[0];
}) {
  void (async () => {
    await options.ensurePanelPort();
    const loadedSettings = await options.loadSettings();
    const pendingSettingsSnapshot = options.getPendingSettingsSnapshot();
    const settings = pendingSettingsSnapshot
      ? { ...loadedSettings, ...pendingSettingsSnapshot }
      : loadedSettings;
    options.clearPendingSettingsSnapshot();
    options.setSettingsHydrated(true);
    options.typographyController.setCurrentFontSize(settings.fontSize);
    options.typographyController.setCurrentLineHeight(settings.lineHeight);
    options.setAutoValue(settings.autoSummarize);
    options.setChatEnabledValue(settings.chatEnabled);
    options.setAutomationEnabledValue(settings.automationEnabled);
    options.setSlidesLayoutValue(settings.slidesLayout);
    options.setSlidesLayoutInputValue(settings.slidesLayout);
    if (!settings.automationEnabled) options.hideAutomationNotice();
    options.appearanceControls.setAutoValue(settings.autoSummarize);
    options.applyChatEnabled();
    options.applySlidesLayout();
    options.appearanceControls.initializeFromSettings(settings);
    options.setDefaultModelPresets();
    options.setModelValue(settings.model);
    options.toggleDrawerClosed();
    options.renderMarkdownDisplay();
    options.sendReady();
    options.scheduleAutoKick();
  })();

  setInterval(() => {
    options.sendPing();
  }, 25_000);

  bindSettingsStorage(options.bindSettingsStorage);
  bindSidepanelLifecycle(options.bindSidepanelLifecycle);
}
