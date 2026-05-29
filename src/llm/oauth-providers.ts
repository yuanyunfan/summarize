/**
 * Constants and request headers for the OAuth-authenticated LLM providers that
 * are NOT plain API keys: ChatGPT (OpenAI OAuth) and Claude (Anthropic OAuth).
 * The daemon's provider-auth layer supplies the bearer token; these helpers
 * shape the endpoint + headers the request layer needs.
 */

/** ChatGPT Codex responses endpoint that accepts the OAuth bearer. */
export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Extra headers for ChatGPT requests (account id identifies the workspace). */
export function buildChatGptHeaders(accountId?: string | null): Record<string, string> {
  return {
    "User-Agent": "summarize",
    originator: "summarize",
    ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
  };
}

/** Anthropic OAuth uses the standard Messages API host with a bearer token. */
export const ANTHROPIC_OAUTH_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
