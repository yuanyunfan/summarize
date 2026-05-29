import { createPkcePair, createState } from "../pkce.js";
import type { OAuthProviderCredential } from "../store.js";

/**
 * Anthropic (Claude Pro/Max) login uses an OAuth **PKCE paste-code** flow: we
 * open the authorize URL in the browser, the user approves and copies back a
 * `code#state` string, which we exchange for OAuth tokens. The access token is
 * used directly as a bearer against the Messages API (with the `oauth-2025-04-20`
 * beta), so no API key is minted.
 */
export const ANTHROPIC_PROVIDER = "anthropic-oauth";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const ANTHROPIC_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const ANTHROPIC_SCOPE = "org:create_api_key user:profile user:inference";

export type AnthropicAuthorization = {
  /** URL the user opens to approve access. */
  url: string;
  /** PKCE verifier to retain for the exchange step. */
  verifier: string;
  state: string;
};

/** Build the authorize URL + PKCE verifier. The flow is paste-code (mode "code"). */
export function buildAnthropicAuthorizeUrl(): AnthropicAuthorization {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const url = new URL(ANTHROPIC_AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", ANTHROPIC_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTHROPIC_REDIRECT_URI);
  url.searchParams.set("scope", ANTHROPIC_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { url: url.href, verifier, state };
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Exchange the pasted `code#state` (Anthropic appends `#<state>` to the code)
 * for OAuth tokens. `expectedState`/`verifier` come from the authorize step.
 */
export async function exchangeAnthropicCode({
  pastedCode,
  verifier,
  expectedState,
  fetchImpl,
  now,
}: {
  pastedCode: string;
  verifier: string;
  expectedState: string;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<OAuthProviderCredential> {
  const trimmed = pastedCode.trim();
  const [code, state] = trimmed.split("#");
  if (!code) {
    throw new Error("Empty authorization code");
  }
  if (state && expectedState && state !== expectedState) {
    throw new Error("State mismatch; restart the login flow");
  }
  const response = await fetchImpl(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state: state ?? expectedState,
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic token exchange failed (${response.status}): ${bodyText}`);
  }
  const data = JSON.parse(bodyText) as TokenResponse;
  const access = asString(data.access_token);
  const refresh = asString(data.refresh_token);
  if (!access || !refresh) {
    throw new Error("Anthropic token exchange missing access/refresh token");
  }
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 0;
  return {
    type: "oauth",
    provider: ANTHROPIC_PROVIDER,
    refresh,
    access,
    expires: expiresInSec > 0 ? now + expiresInSec * 1000 : 0,
  };
}

/** Refresh an expired Anthropic access token. */
export async function refreshAnthropicToken({
  refresh,
  fetchImpl,
  now,
}: {
  refresh: string;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<OAuthProviderCredential> {
  const response = await fetchImpl(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: ANTHROPIC_CLIENT_ID,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic token refresh failed (${response.status}). Re-login required.`);
  }
  const data = JSON.parse(bodyText) as TokenResponse;
  const access = asString(data.access_token);
  if (!access) {
    throw new Error("Anthropic token refresh returned no access token");
  }
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 0;
  return {
    type: "oauth",
    provider: ANTHROPIC_PROVIDER,
    refresh: asString(data.refresh_token) ?? refresh,
    access,
    expires: expiresInSec > 0 ? now + expiresInSec * 1000 : 0,
  };
}
