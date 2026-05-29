import { buildCopilotHeaders, COPILOT_API_BASE_URL } from "../../llm/copilot.js";
import { GITHUB_COPILOT_PROVIDER } from "./plugins/github-copilot-device.js";
import { getCredential, setCredential, type OAuthProviderCredential } from "./store.js";

/**
 * Copilot bearer resolution. For most accounts the GitHub OAuth token must be
 * exchanged for a short-lived Copilot bearer via
 * `api.github.com/copilot_internal/v2/token`. Some accounts (e.g. Copilot
 * Enterprise) are not entitled to that exchange (it 404s) but accept the GitHub
 * OAuth token directly as the `api.githubcopilot.com` bearer — see
 * {@link resolveCopilotAccessToken} for the fallback.
 */
const COPILOT_TOKEN_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_EDITOR_VERSION = "summarize/1.0";
const EXPIRY_SKEW_MS = 60_000;
/** TTL for the direct-GitHub-token fallback when the exchange endpoint 404s. */
const DIRECT_TOKEN_TTL_MS = 25 * 60 * 1000;

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

  // Some accounts (e.g. Copilot Enterprise) are not entitled to the
  // `copilot_internal/v2/token` exchange — it 404s — but the GitHub OAuth token
  // works directly as the Copilot API bearer. Try the exchange first; on any
  // failure, fall back to the GitHub token directly.
  try {
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
  } catch {
    // Cache the direct-token fallback with a short TTL so we don't re-attempt
    // the doomed exchange on every call (it adds a ~1s round-trip).
    const updated: OAuthProviderCredential = {
      ...credential,
      access: credential.refresh,
      expires: now + DIRECT_TOKEN_TTL_MS,
    };
    await setCredential(env, updated);
    return credential.refresh;
  }
}

/**
 * List the Copilot model ids available to the logged-in account by querying
 * `GET {COPILOT_API_BASE_URL}/models` with the exchanged bearer. Returns an
 * empty array when not logged in or the request fails, so callers can fall back
 * to a curated default set.
 */
export async function discoverCopilotModelIds({
  env,
  fetchImpl,
  now,
  timeoutMs = 4000,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
  timeoutMs?: number;
}): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Token resolution can throw (exchange failure); treat that as "no models"
    // so the picker falls back to the curated default set.
    const accessToken = await resolveCopilotAccessToken({ env, fetchImpl, now });
    if (!accessToken) return [];
    const response = await fetchImpl(`${COPILOT_API_BASE_URL}/models`, {
      method: "GET",
      headers: {
        ...buildCopilotHeaders(),
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const json = (await response.json()) as unknown;
    const data = json && typeof json === "object" ? (json as { data?: unknown }).data : undefined;
    if (!Array.isArray(data)) return [];
    const ids = data
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as { id?: unknown; model_picker_enabled?: unknown };
        // Only surface models the Copilot picker exposes when the flag is present.
        if (record.model_picker_enabled === false) return null;
        return typeof record.id === "string" && record.id.trim().length > 0
          ? record.id.trim()
          : null;
      })
      .filter((id): id is string => id !== null);
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
