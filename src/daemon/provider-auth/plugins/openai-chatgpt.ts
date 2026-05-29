import http from "node:http";
import { createPkcePair, createState, decodeJwtPayload } from "../pkce.js";
import type { OAuthProviderCredential } from "../store.js";

/**
 * OpenAI (ChatGPT Pro/Plus) login uses an OAuth **loopback PKCE** flow, mirroring
 * the Codex CLI: we start a local HTTP server on port 1455, open the authorize
 * URL, and OpenAI redirects back to `http://localhost:1455/auth/callback` with a
 * code we exchange for tokens. The access token is used as a bearer against the
 * ChatGPT Codex responses endpoint, with the account id taken from the id_token.
 */
export const OPENAI_PROVIDER = "openai-chatgpt";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_AUTHORIZE_URL = `${OPENAI_ISSUER}/oauth/authorize`;
const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`;
const OPENAI_CALLBACK_PORT = 1455;
const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`;
const OPENAI_SCOPE = "openid profile email offline_access";

/** ChatGPT Codex responses endpoint that accepts the OAuth bearer. */
export const OPENAI_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

export type OpenAiLoopbackSession = {
  /** URL the user opens to approve access. */
  url: string;
  /** Resolves with a persistable credential when the callback completes. */
  wait: () => Promise<OAuthProviderCredential>;
  /** Stop the loopback server (called on cancel/expiry/done). */
  close: () => void;
};

function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(OPENAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "summarize");
  return url.href;
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resolveAccountId(idToken: string | null): string | undefined {
  if (!idToken) return undefined;
  const claims = decodeJwtPayload(idToken);
  if (!claims) return undefined;
  const direct = asString(claims.chatgpt_account_id);
  if (direct) return direct;
  const orgs = claims.organizations;
  if (Array.isArray(orgs) && orgs.length > 0) {
    const first = orgs[0] as Record<string, unknown>;
    return asString(first?.id) ?? undefined;
  }
  return undefined;
}

async function exchangeCode({
  code,
  verifier,
  fetchImpl,
  now,
}: {
  code: string;
  verifier: string;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<OAuthProviderCredential> {
  const response = await fetchImpl(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: OPENAI_CLIENT_ID,
      redirect_uri: OPENAI_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI token exchange failed (${response.status}): ${bodyText}`);
  }
  const data = JSON.parse(bodyText) as TokenResponse;
  const access = asString(data.access_token);
  const refresh = asString(data.refresh_token);
  if (!access || !refresh) {
    throw new Error("OpenAI token exchange missing access/refresh token");
  }
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 0;
  return {
    type: "oauth",
    provider: OPENAI_PROVIDER,
    refresh,
    access,
    expires: expiresInSec > 0 ? now + expiresInSec * 1000 : 0,
    accountId: resolveAccountId(asString(data.id_token)),
  };
}

/**
 * Start the loopback server and return the authorize URL plus a `wait()` that
 * resolves once OpenAI redirects back with a valid code. The server auto-closes
 * after success, error, or {@link timeoutMs}.
 */
export function startOpenAiLoopback({
  fetchImpl,
  now,
  timeoutMs = 5 * 60 * 1000,
}: {
  fetchImpl: typeof fetch;
  now: number;
  timeoutMs?: number;
}): Promise<OpenAiLoopbackSession> {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const url = buildAuthorizeUrl(challenge, state);

  return new Promise((resolveSession, rejectSession) => {
    let settle: ((credential: OAuthProviderCredential) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const resultPromise = new Promise<OAuthProviderCredential>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const server = http.createServer((req, res) => {
      void (async () => {
        const reqUrl = new URL(req.url ?? "/", `http://localhost:${OPENAI_CALLBACK_PORT}`);
        if (reqUrl.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const code = reqUrl.searchParams.get("code");
        const returnedState = reqUrl.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>登录失败</h1><p>状态校验失败，请重试。</p>");
          fail?.(new Error("OpenAI callback state mismatch"));
          return;
        }
        try {
          const credential = await exchangeCode({ code, verifier, fetchImpl, now: Date.now() });
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>登录成功</h1><p>可以关闭此页面，返回扩展。</p>");
          settle?.(credential);
        } catch (error) {
          res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
          res.end("<h1>登录失败</h1><p>令牌交换失败，请重试。</p>");
          fail?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    const close = () => {
      if (timer) clearTimeout(timer);
      server.close();
    };

    server.once("error", (error) => {
      rejectSession(
        new Error(
          `无法在端口 ${OPENAI_CALLBACK_PORT} 启动登录回调服务（${error.message}）。请确保端口空闲。`,
        ),
      );
    });

    server.listen(OPENAI_CALLBACK_PORT, "127.0.0.1", () => {
      timer = setTimeout(() => {
        fail?.(new Error("OpenAI login timed out"));
      }, timeoutMs);
      // unref so a pending login never keeps the daemon alive.
      timer.unref?.();
      resolveSession({
        url,
        wait: () => resultPromise.finally(close),
        close,
      });
    });
  });
}

/** Refresh an expired ChatGPT access token. */
export async function refreshOpenAiToken({
  refresh,
  fetchImpl,
  now,
}: {
  refresh: string;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<OAuthProviderCredential> {
  const response = await fetchImpl(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: OPENAI_CLIENT_ID,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI token refresh failed (${response.status}). Re-login required.`);
  }
  const data = JSON.parse(bodyText) as TokenResponse;
  const access = asString(data.access_token);
  if (!access) {
    throw new Error("OpenAI token refresh returned no access token");
  }
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 0;
  return {
    type: "oauth",
    provider: OPENAI_PROVIDER,
    refresh: asString(data.refresh_token) ?? refresh,
    access,
    expires: expiresInSec > 0 ? now + expiresInSec * 1000 : 0,
    accountId: resolveAccountId(asString(data.id_token)),
  };
}
