import { loadSettings } from "../../lib/settings";

type StatusState = "idle" | "running" | "error" | "ok";
type AuthKind = "device" | "loopback" | "code";

const DAEMON_BASE_URL = "http://127.0.0.1:8787";

type AuthMethod = { provider: string; label: string; kind: AuthKind };

type MethodsResponse = { ok?: boolean; methods?: AuthMethod[] };

type AuthorizeResponse = {
  ok?: boolean;
  error?: string;
  pendingId?: string;
  kind?: AuthKind;
  userCode?: string;
  verificationUri?: string;
  interval?: number;
};

type PollResponse = {
  ok?: boolean;
  status?: "pending" | "done" | "error";
  interval?: number;
  message?: string;
};

type ExchangeResponse = { ok?: boolean; status?: "done" | "error"; message?: string };

type StatusResponse = {
  ok?: boolean;
  providers?: Array<{ provider: string; label: string; loggedIn: boolean }>;
};

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await loadSettings()).token.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives all third-party logins (GitHub Copilot device flow, OpenAI ChatGPT
 * loopback, Anthropic paste-code) from the sidepanel via the daemon's
 * `/v1/auth/*` endpoints. The active provider is chosen from a dropdown; on a
 * successful login/logout the model list is refreshed so the provider's models
 * appear.
 */
export function createAuthController({
  providerSelectEl,
  loginBtn,
  logoutBtn,
  codeRowEl,
  codeInputEl,
  codeSubmitBtn,
  accountsStatusEl,
  onLoginChanged,
}: {
  providerSelectEl: HTMLSelectElement;
  loginBtn: HTMLButtonElement;
  logoutBtn: HTMLButtonElement;
  /** Container shown only while a paste-code (Anthropic) login is in progress. */
  codeRowEl: HTMLElement;
  codeInputEl: HTMLInputElement;
  codeSubmitBtn: HTMLButtonElement;
  accountsStatusEl: HTMLElement;
  /** Called after login/logout completes so the caller can refresh models. */
  onLoginChanged: () => void;
}) {
  let busy = false;
  let methods: AuthMethod[] = [];
  let loggedIn = new Set<string>();
  /** Pending paste-code login awaiting the user's pasted code. */
  let pendingCode: { provider: string; pendingId: string } | null = null;

  const setStatus = (text: string, state: StatusState = "idle") => {
    accountsStatusEl.textContent = text;
    if (state === "idle") {
      accountsStatusEl.removeAttribute("data-state");
    } else {
      accountsStatusEl.setAttribute("data-state", state);
    }
  };

  const selectedProvider = () => providerSelectEl.value;

  const syncButtons = () => {
    const provider = selectedProvider();
    const isLoggedIn = loggedIn.has(provider);
    loginBtn.hidden = isLoggedIn;
    logoutBtn.hidden = !isLoggedIn;
    codeRowEl.hidden = !pendingCode || pendingCode.provider !== provider;
  };

  const populateProviders = async () => {
    try {
      const response = await fetch(`${DAEMON_BASE_URL}/v1/auth/methods`, {
        headers: await authHeaders(),
      });
      const data = (await response.json()) as MethodsResponse;
      methods = data.methods ?? [];
    } catch {
      methods = [];
    }
    providerSelectEl.innerHTML = "";
    for (const method of methods) {
      const option = document.createElement("option");
      option.value = method.provider;
      option.textContent = method.label;
      providerSelectEl.append(option);
    }
  };

  const methodFor = (provider: string): AuthMethod | undefined =>
    methods.find((m) => m.provider === provider);

  const refreshStatus = async () => {
    if (methods.length === 0) await populateProviders();
    try {
      const response = await fetch(`${DAEMON_BASE_URL}/v1/auth/status`, {
        headers: await authHeaders(),
      });
      const data = (await response.json()) as StatusResponse;
      loggedIn = new Set((data.providers ?? []).filter((p) => p.loggedIn).map((p) => p.provider));
    } catch {
      loggedIn = new Set();
    }
    syncButtons();
    const provider = selectedProvider();
    if (loggedIn.has(provider)) {
      setStatus(`已登录 ${methodFor(provider)?.label ?? provider}`, "ok");
    } else if (!pendingCode) {
      setStatus("", "idle");
    }
  };

  const finishLogin = (provider: string) => {
    loggedIn.add(provider);
    pendingCode = null;
    syncButtons();
    setStatus(`登录成功，已加载 ${methodFor(provider)?.label ?? provider} 模型`, "ok");
    onLoginChanged();
  };

  const pollUntilDone = async (pendingId: string, provider: string, intervalSeconds: number) => {
    let intervalMs = Math.max(1, intervalSeconds) * 1000;
    const deadline = Date.now() + 16 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const pollRes = await fetch(`${DAEMON_BASE_URL}/v1/auth/poll`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ pendingId }),
      });
      const poll = (await pollRes.json()) as PollResponse;
      if (poll.status === "done") {
        finishLogin(provider);
        return;
      }
      if (poll.status === "error") {
        setStatus(poll.message ?? "登录失败", "error");
        return;
      }
      if (typeof poll.interval === "number" && poll.interval > 0) {
        intervalMs = poll.interval * 1000;
      }
    }
    setStatus("登录超时，请重试", "error");
  };

  const runLogin = async () => {
    if (busy) return;
    const provider = selectedProvider();
    const method = methodFor(provider);
    if (!method) {
      setStatus("没有可用的登录方式（daemon 未运行？）", "error");
      return;
    }
    busy = true;
    loginBtn.disabled = true;
    try {
      setStatus("正在初始化登录…", "running");
      const authorizeRes = await fetch(`${DAEMON_BASE_URL}/v1/auth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ provider }),
      });
      const authorize = (await authorizeRes.json()) as AuthorizeResponse;
      if (!authorize.ok || !authorize.pendingId) {
        setStatus(authorize.error ?? "无法启动登录流程", "error");
        return;
      }
      const verificationUri = authorize.verificationUri ?? "";
      if (verificationUri) {
        try {
          window.open(verificationUri, "_blank", "noopener");
        } catch {
          // Popup blocked: the status text still shows the URL.
        }
      }

      if (authorize.kind === "device") {
        setStatus(`请在浏览器打开 ${verificationUri}，输入代码：${authorize.userCode}`, "running");
        await pollUntilDone(authorize.pendingId, provider, authorize.interval ?? 5);
        return;
      }

      if (authorize.kind === "loopback") {
        setStatus(`已打开浏览器登录页，请完成授权…\n若未自动打开：${verificationUri}`, "running");
        await pollUntilDone(authorize.pendingId, provider, 2);
        return;
      }

      if (authorize.kind === "code") {
        pendingCode = { provider, pendingId: authorize.pendingId };
        codeInputEl.value = "";
        syncButtons();
        setStatus(`已打开授权页，请复制返回的代码并粘贴到下方输入框。`, "running");
        return;
      }

      setStatus("不支持的登录方式", "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`登录出错：${message}`, "error");
    } finally {
      busy = false;
      loginBtn.disabled = false;
    }
  };

  const submitCode = async () => {
    if (!pendingCode) return;
    const code = codeInputEl.value.trim();
    if (!code) {
      setStatus("请粘贴授权代码", "error");
      return;
    }
    codeSubmitBtn.disabled = true;
    try {
      setStatus("正在校验代码…", "running");
      const res = await fetch(`${DAEMON_BASE_URL}/v1/auth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ pendingId: pendingCode.pendingId, code }),
      });
      const data = (await res.json()) as ExchangeResponse;
      if (data.status === "done") {
        finishLogin(pendingCode.provider);
      } else {
        setStatus(data.message ?? "代码校验失败", "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`校验出错：${message}`, "error");
    } finally {
      codeSubmitBtn.disabled = false;
    }
  };

  const runLogout = async () => {
    const provider = selectedProvider();
    logoutBtn.disabled = true;
    try {
      await fetch(`${DAEMON_BASE_URL}/v1/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ provider }),
      });
      loggedIn.delete(provider);
      pendingCode = null;
      syncButtons();
      setStatus(`已退出 ${methodFor(provider)?.label ?? provider}`, "idle");
      onLoginChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`退出出错：${message}`, "error");
    } finally {
      logoutBtn.disabled = false;
    }
  };

  providerSelectEl.addEventListener("change", () => {
    void refreshStatus();
  });

  return { runLogin, runLogout, submitCode, refreshStatus };
}
