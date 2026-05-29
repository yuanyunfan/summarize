import { COPILOT_API_BASE_URL } from "../../llm/copilot.js";
import { GITHUB_COPILOT_PROVIDER } from "./plugins/github-copilot-device.js";
import { getCredential, setCredential, type OAuthProviderCredential } from "./store.js";

/**
 * The Copilot API at `api.githubcopilot.com` does not accept the GitHub OAuth
 * token directly. The token must be exchanged for a short-lived Copilot bearer
 * via `api.github.com/copilot_internal/v2/token`, which returns a token plus an
 * `expires_at` (epoch seconds). We cache the exchanged token on the stored
 * credential's `access`/`expires` fields and only re-exchange when stale.
 */
const COPILOT_TOKEN_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_EDITOR_VERSION = "summarize/1.0";
const EXPIRY_SKEW_MS = 60_000;

export { COPILOT_API_BASE_URL };

type CopilotTokenResponse = {
  token?: unknown;
  expires_at?: unknown;
};

async function exchangeGitHubTokenForCopilotToken({
  githubToken,
  fetchImpl,
}: {
  githubToken: string;
  fetchImpl: typeof fetch;
}): Promise<{ token: string; expiresAtMs: number }> {
  const response = await fetchImpl(COPILOT_TOKEN_EXCHANGE_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "Editor-Version": COPILOT_EDITOR_VERSION,
      "User-Agent": "summarize",
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Copilot token exchange failed (${response.status}). Re-login may be required.`,
    );
  }
  const data = JSON.parse(bodyText) as CopilotTokenResponse;
  const token = typeof data.token === "string" ? data.token.trim() : "";
  if (!token) {
    throw new Error("Copilot token exchange returned no token");
  }
  const expiresAtSec =
    typeof data.expires_at === "number" && Number.isFinite(data.expires_at) ? data.expires_at : 0;
  return { token, expiresAtMs: expiresAtSec > 0 ? expiresAtSec * 1000 : 0 };
}

/**
 * Returns a valid short-lived Copilot bearer for the logged-in account, doing a
 * fresh exchange (and persisting the result) when the cached token is missing
 * or within {@link EXPIRY_SKEW_MS} of expiry. Returns null when not logged in.
 */
export async function resolveCopilotAccessToken({
  env,
  fetchImpl,
  now,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<string | null> {
  const credential = await getCredential(env, GITHUB_COPILOT_PROVIDER);
  if (!credential || credential.type !== "oauth") return null;

  const fresh =
    credential.access.trim().length > 0 &&
    credential.expires > 0 &&
    credential.expires - EXPIRY_SKEW_MS > now;
  if (fresh) return credential.access;

  const { token, expiresAtMs } = await exchangeGitHubTokenForCopilotToken({
    githubToken: credential.refresh,
    fetchImpl,
  });
  const updated: OAuthProviderCredential = {
    ...credential,
    access: token,
    expires: expiresAtMs,
  };
  await setCredential(env, updated);
  return token;
}
