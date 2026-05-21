const DAEMON_STATUS_TIMEOUT_MS = 5000;
const DAEMON_STATUS_RETRY_DELAY_MS = 400;
const DAEMON_STATUS_MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function shouldRetryDaemon(err: unknown) {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const message = err instanceof Error ? err.message : "";
  return message.toLowerCase() === "failed to fetch";
}

export function createDaemonStatusChecker({
  statusEl,
  fetchImpl = fetch,
  getExtensionVersion,
}: {
  statusEl: HTMLDivElement;
  fetchImpl?: typeof fetch;
  getExtensionVersion: () => string;
}) {
  const setDaemonStatus = (text: string, state?: "ok" | "warn" | "error") => {
    const textEl = statusEl.querySelector<HTMLElement>(".daemonStatus__text");
    if (textEl) {
      textEl.textContent = text;
    } else {
      statusEl.textContent = text;
    }
    if (state) {
      statusEl.dataset.state = state;
    } else {
      delete statusEl.dataset.state;
    }
  };

  let daemonCheckId = 0;

  const fetchWithRetry = async (url: string, options: RequestInit = {}) => {
    for (let attempt = 0; attempt < DAEMON_STATUS_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), DAEMON_STATUS_TIMEOUT_MS);
      try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (attempt < DAEMON_STATUS_MAX_ATTEMPTS - 1 && shouldRetryDaemon(error)) {
          window.clearTimeout(timeout);
          await sleep(DAEMON_STATUS_RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    }
    throw new Error("health failed");
  };

  const checkDaemonStatus = async (token: string) => {
    daemonCheckId += 1;
    const checkId = daemonCheckId;
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setDaemonStatus("添加 token 以验证 daemon 连接", "warn");
      return;
    }

    setDaemonStatus("正在检查 daemon…");

    try {
      const res = await fetchWithRetry("http://127.0.0.1:8787/health");
      if (checkId !== daemonCheckId) return;
      if (!res.ok) {
        setDaemonStatus(
          `Daemon 错误（${res.status} ${res.statusText}）— 请运行 \`summarize daemon status\``,
          "error",
        );
        return;
      }
      const json = (await res.json()) as { version?: unknown };
      const daemonVersion = typeof json.version === "string" ? json.version.trim() : "";
      const extVersion = getExtensionVersion();
      const versionNote = daemonVersion ? `v${daemonVersion}` : "版本未知";

      try {
        const ping = await fetchWithRetry("http://127.0.0.1:8787/v1/ping", {
          headers: { Authorization: `Bearer ${trimmedToken}` },
        });
        if (checkId !== daemonCheckId) return;
        if (!ping.ok) {
          setDaemonStatus(
            `Daemon ${versionNote}（token 不匹配）— 请在侧边栏更新 token 并保存`,
            "warn",
          );
          return;
        }
      } catch {
        if (checkId !== daemonCheckId) return;
        setDaemonStatus(`Daemon ${versionNote}（认证失败）— 请在侧边栏更新 token 并保存`, "warn");
        return;
      }

      if (daemonVersion && extVersion && daemonVersion !== extVersion) {
        setDaemonStatus(`Daemon ${versionNote} (extension v${extVersion})`, "warn");
        return;
      }

      setDaemonStatus(`Daemon ${versionNote} 已连接`, "ok");
    } catch {
      if (checkId !== daemonCheckId) return;
      setDaemonStatus(
        "Daemon 无法连接 — 请运行 `summarize daemon status` 并检查 ~/.summarize/logs/daemon.err.log",
        "error",
      );
    }
  };

  return { checkDaemonStatus, setDaemonStatus };
}
