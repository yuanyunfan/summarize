import { refreshAnthropicToken, ANTHROPIC_PROVIDER } from "./plugins/anthropic-oauth.js";
import { refreshOpenAiToken, OPENAI_PROVIDER } from "./plugins/openai-chatgpt.js";
import { getCredential, setCredential } from "./store.js";

/**
 * Resolve valid OAuth access tokens for the ChatGPT/Anthropic logins, refreshing
 * and re-persisting when the cached token is missing or near expiry. Copilot has
 * its own exchange (`copilot-token.ts`) because it swaps a GitHub token for a
 * Copilot-specific bearer rather than refreshing in place.
 */
const EXPIRY_SKEW_MS = 60_000;

export type ResolvedOAuth = {
  accessToken: string;
  accountId?: string;
};

function isFresh(access: string, expires: number, now: number): boolean {
  return access.trim().length > 0 && (expires === 0 || expires - EXPIRY_SKEW_MS > now);
}

export async function resolveOpenAiChatGptToken({
  env,
  fetchImpl,
  now,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<ResolvedOAuth | null> {
  const credential = await getCredential(env, OPENAI_PROVIDER);
  if (!credential || credential.type !== "oauth") return null;
  if (isFresh(credential.access, credential.expires, now)) {
    return { accessToken: credential.access, accountId: credential.accountId };
  }
  const refreshed = await refreshOpenAiToken({ refresh: credential.refresh, fetchImpl, now });
  // Preserve a previously-known account id if the refresh response omitted it.
  const next = { ...refreshed, accountId: refreshed.accountId ?? credential.accountId };
  await setCredential(env, next);
  return { accessToken: next.access, accountId: next.accountId };
}

export async function resolveAnthropicToken({
  env,
  fetchImpl,
  now,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<ResolvedOAuth | null> {
  const credential = await getCredential(env, ANTHROPIC_PROVIDER);
  if (!credential || credential.type !== "oauth") return null;
  if (isFresh(credential.access, credential.expires, now)) {
    return { accessToken: credential.access };
  }
  const refreshed = await refreshAnthropicToken({ refresh: credential.refresh, fetchImpl, now });
  await setCredential(env, refreshed);
  return { accessToken: refreshed.access };
}
