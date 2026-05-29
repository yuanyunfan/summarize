/**
 * GitHub Copilot subscription API (`api.githubcopilot.com`) constants and
 * request headers. This is distinct from GitHub Models (`models.github.ai`,
 * see `github-models.ts`) which authenticates with a personal access token.
 *
 * Copilot requires a short-lived bearer (exchanged from the GitHub OAuth token
 * by the daemon's provider-auth layer) plus editor-identifying headers.
 */
export const COPILOT_API_BASE_URL = "https://api.githubcopilot.com";
const COPILOT_EDITOR_VERSION = "summarize/1.0";

export function buildCopilotHeaders(existing?: Record<string, string>): Record<string, string> {
  return {
    ...(existing ?? {}),
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_EDITOR_VERSION,
    "Copilot-Integration-Id": "vscode-chat",
    "User-Agent": "summarize",
  };
}
