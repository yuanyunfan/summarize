export type UserScriptsStatus = {
  apiAvailable: boolean;
  permissionGranted: boolean;
  chromeVersion: number | null;
};

export function getChromeVersion(): number | null {
  const match = navigator.userAgent.match(/(Chrome|Chromium)\/(\d+)/);
  if (!match) return null;
  return Number(match[2]);
}

export async function getUserScriptsStatus(): Promise<UserScriptsStatus> {
  const apiAvailable = Boolean(chrome.userScripts);
  const permissionGranted = Boolean(
    await chrome.permissions?.contains?.({ permissions: ["userScripts"] }),
  );
  return {
    apiAvailable,
    permissionGranted,
    chromeVersion: getChromeVersion(),
  };
}

// Returns a user-facing, actionable message for the current userScripts status.
export function buildUserScriptsGuidance(status: UserScriptsStatus): string {
  const chromeVersion = status.chromeVersion ?? 0;
  const permissionHint = status.permissionGranted ? null : "请先在设置里点击“启用自动化权限”。";

  if (status.apiAvailable) {
    return [
      permissionHint,
      "需要 User Scripts 权限。请在 Options → 自动化权限里启用，然后在 chrome://extensions 里允许 “User Scripts”。",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (chromeVersion >= 138) {
    return [
      permissionHint,
      `检测到 Chrome ${chromeVersion}。启用 User Scripts：\n\n1. 打开 chrome://extensions/\n2. 找到这个扩展并点击“详情”\n3. 打开“允许 User Scripts”开关\n4. 重新加载页面后重试`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (chromeVersion >= 120) {
    return [
      permissionHint,
      `检测到 Chrome ${chromeVersion}。userScripts API 需要 Chrome 120+ 并启用实验特性。请更新 Chrome 后重试。`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (chromeVersion > 0) {
    return [
      permissionHint,
      `检测到 Chrome ${chromeVersion}。userScripts API 需要 Chrome 120 或更高版本。请更新 Chrome。`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [permissionHint, "当前浏览器不可用 User Scripts API。"].filter(Boolean).join(" ");
}
