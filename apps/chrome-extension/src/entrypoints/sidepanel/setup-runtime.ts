import { installStepsHtml, wireSetupButtons } from "./setup-view";
import type { UiState } from "./types";

export type PlatformKind = "mac" | "windows" | "linux" | "other";

export function resolvePlatformKind(): PlatformKind {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const uaPlatform = nav.userAgentData?.platform;
  const effectivePlatform = uaPlatform && uaPlatform.trim() ? uaPlatform : navigator.platform;
  const raw = (effectivePlatform ?? navigator.userAgent ?? "").toLowerCase().trim();

  if (raw.includes("mac")) return "mac";
  if (raw.includes("win")) return "windows";
  if (raw.includes("linux") || raw.includes("cros") || raw.includes("chrome os")) return "linux";
  return "other";
}

export function friendlyFetchError(err: unknown, context: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase() === "failed to fetch") {
    return `${context}: 请求失败（daemon 不可达或被 Chrome 阻止；可尝试 \`summarize daemon status\`，必要时运行 \`summarize daemon restart\`，并检查 ~/.summarize/logs/daemon.err.log）`;
  }
  return `${context}: ${message}`;
}

export function createSetupRuntime(options: {
  setupEl: HTMLDivElement;
  loadToken: () => Promise<string>;
  ensureToken: () => Promise<string>;
  patchSettings: typeof import("../../lib/settings").patchSettings;
  generateToken: typeof import("../../lib/token").generateToken;
  headerSetStatus: (text: string) => void;
  getStatusResetText: () => string;
}) {
  const platformKind = resolvePlatformKind();

  const renderSetup = (token: string) => {
    options.setupEl.classList.remove("hidden");
    options.setupEl.innerHTML = installStepsHtml({
      token,
      headline: "设置",
      message: "安装 summarize，然后注册 daemon，侧边栏才能流式生成摘要。",
      platformKind,
    });
    wireSetupButtons({
      setupEl: options.setupEl,
      token,
      platformKind,
      headerSetStatus: options.headerSetStatus,
      getStatusResetText: options.getStatusResetText,
      patchSettings: options.patchSettings,
      generateToken: options.generateToken,
      renderSetup,
    });
  };

  const maybeShowSetup = (state: UiState) => {
    if (!state.settings.tokenPresent) {
      void options.ensureToken().then((token) => {
        renderSetup(token);
      });
      return true;
    }
    if (!state.daemon.ok || !state.daemon.authed) {
      options.setupEl.classList.remove("hidden");
      void options.loadToken().then((token) => {
        options.setupEl.innerHTML = `
          ${installStepsHtml({
            token,
            headline: "无法连接 daemon",
            message: state.daemon.error ?? "检查 LaunchAgent 是否已安装。",
            platformKind,
            showTroubleshooting: true,
          })}
        `;
        wireSetupButtons({
          setupEl: options.setupEl,
          token,
          platformKind,
          headerSetStatus: options.headerSetStatus,
          getStatusResetText: options.getStatusResetText,
          patchSettings: options.patchSettings,
          generateToken: options.generateToken,
          renderSetup,
        });
      });
      return true;
    }
    options.setupEl.classList.add("hidden");
    return false;
  };

  return {
    platformKind,
    renderSetup,
    maybeShowSetup,
  };
}
