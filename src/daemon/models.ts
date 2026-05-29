import { getModels } from "@earendil-works/pi-ai";
import { isOpenRouterBaseUrl } from "@steipete/summarize-core";
import type { SummarizeConfig } from "../config.js";
import { resolveCliAvailability } from "../run/env.js";
import { resolveEnvState } from "../run/run-env.js";
import { ANTHROPIC_PROVIDER } from "./provider-auth/plugins/anthropic-oauth.js";
import { GITHUB_COPILOT_PROVIDER } from "./provider-auth/plugins/github-copilot-device.js";
import { OPENAI_PROVIDER } from "./provider-auth/plugins/openai-chatgpt.js";
import { isProviderLoggedIn } from "./provider-auth/registry.js";

/**
 * Curated Copilot models surfaced after a successful GitHub Copilot login.
 * Kept conservative; the user can still type any `copilot/<id>` manually.
 */
const COPILOT_MODEL_IDS = ["gpt-4o", "gpt-4.1", "o4-mini", "claude-sonnet-4"] as const;

/** Models surfaced after a ChatGPT (OpenAI OAuth) login. */
const CHATGPT_MODEL_IDS = ["gpt-5.2", "gpt-5.2-codex"] as const;

/** Models surfaced after an Anthropic (Claude OAuth) login. */
const ANTHROPIC_OAUTH_MODEL_IDS = ["claude-sonnet-4-5", "claude-opus-4-1"] as const;

export type ModelPickerOption = {
  id: string;
  label: string;
};

function uniqById(options: ModelPickerOption[]): ModelPickerOption[] {
  const seen = new Set<string>();
  const out: ModelPickerOption[] = [];
  for (const opt of options) {
    const id = opt.id.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: opt.label.trim() || id });
  }
  return out;
}

function isProbablyOpenRouterBaseUrl(baseUrl: string): boolean {
  return isOpenRouterBaseUrl(baseUrl);
}

function isProbablyZaiBaseUrl(baseUrl: string): boolean {
  return /api\.z\.ai/i.test(baseUrl);
}

function describeBaseUrlHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    const host = url.host.trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function pushPiAiModels({
  options,
  provider,
  prefix,
  labelPrefix,
}: {
  options: ModelPickerOption[];
  provider: Parameters<typeof getModels>[0];
  prefix: string;
  labelPrefix: string;
}) {
  const models = getModels(provider)
    .slice()
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  for (const m of models) {
    const id = `${prefix}${m.id}`;
    const label = `${labelPrefix}${m.name || m.id}`;
    options.push({ id, label });
  }
}

async function discoverOpenAiCompatibleModelIds({
  baseUrl,
  apiKey,
  fetchImpl,
  timeoutMs,
}: {
  baseUrl: string;
  apiKey: string | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string[]> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const modelsUrl = new URL("models", base).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(modelsUrl, {
      method: "GET",
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") return [];

    const obj = json as Record<string, unknown>;
    const data = obj.data;
    if (Array.isArray(data)) {
      const ids = data
        .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
      return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
    }

    const models = obj.models;
    if (Array.isArray(models)) {
      const ids = models
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
      return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
    }

    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildModelPickerOptions({
  env,
  envForRun,
  configForCli,
  fetchImpl,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  configForCli: SummarizeConfig | null;
  fetchImpl: typeof fetch;
}): Promise<{
  ok: true;
  options: ModelPickerOption[];
  providers: {
    xai: boolean;
    openai: boolean;
    nvidia: boolean;
    google: boolean;
    anthropic: boolean;
    openrouter: boolean;
    zai: boolean;
    copilotOAuth: boolean;
    chatgptOAuth: boolean;
    anthropicOAuth: boolean;
    cliClaude: boolean;
    cliGemini: boolean;
    cliCodex: boolean;
    cliAgent: boolean;
    cliOpenclaw: boolean;
    cliOpencode: boolean;
    cliCopilot: boolean;
  };
  openaiBaseUrl: string | null;
  localModelsSource: { kind: "openai-compatible"; baseUrlHost: string } | null;
}> {
  const envState = resolveEnvState({ env, envForRun, configForCli });

  const providers = {
    xai: Boolean(envState.xaiApiKey),
    openai: Boolean(envState.apiKey),
    nvidia: Boolean(envState.nvidiaApiKey),
    google: envState.googleConfigured,
    anthropic: envState.anthropicConfigured,
    openrouter: envState.openrouterConfigured,
    zai: Boolean(envState.zaiApiKey),
    copilotOAuth: false,
    chatgptOAuth: false,
    anthropicOAuth: false,
    cliClaude: false,
    cliGemini: false,
    cliCodex: false,
    cliAgent: false,
    cliOpenclaw: false,
    cliOpencode: false,
    cliCopilot: false,
  };
  const cliAvailability = resolveCliAvailability({ env: envForRun, config: configForCli });
  providers.cliClaude = Boolean(cliAvailability.claude);
  providers.cliGemini = Boolean(cliAvailability.gemini);
  providers.cliCodex = Boolean(cliAvailability.codex);
  providers.cliAgent = Boolean(cliAvailability.agent);
  providers.cliOpenclaw = Boolean(cliAvailability.openclaw);
  providers.cliOpencode = Boolean(cliAvailability.opencode);
  providers.cliCopilot = Boolean(cliAvailability.copilot);

  providers.copilotOAuth = await isProviderLoggedIn(env, GITHUB_COPILOT_PROVIDER);
  providers.chatgptOAuth = await isProviderLoggedIn(env, OPENAI_PROVIDER);
  providers.anthropicOAuth = await isProviderLoggedIn(env, ANTHROPIC_PROVIDER);

  const options: ModelPickerOption[] = [
    { id: "auto", label: "Auto" },
    { id: "fast", label: "OpenAI GPT-5.5 Fast" },
    { id: "codex-fast", label: "GPT Fast (Codex)" },
  ];

  if (providers.cliClaude) {
    options.push({ id: "cli/claude", label: "CLI: Claude" });
  }
  if (providers.cliGemini) {
    options.push({ id: "cli/gemini", label: "CLI: Gemini" });
  }
  if (providers.cliCodex) {
    options.push({ id: "cli/codex", label: "CLI: Codex" });
  }
  if (providers.cliAgent) {
    options.push({ id: "cli/agent", label: "CLI: Cursor Agent" });
  }
  if (providers.cliOpenclaw) {
    options.push({ id: "cli/openclaw", label: "CLI: OpenClaw" });
  }
  if (providers.cliOpencode) {
    options.push({ id: "cli/opencode", label: "CLI: OpenCode" });
  }
  if (providers.cliCopilot) {
    options.push({ id: "cli/copilot", label: "CLI: GitHub Copilot" });
  }

  if (providers.copilotOAuth) {
    for (const id of COPILOT_MODEL_IDS) {
      options.push({ id: `copilot/${id}`, label: `Copilot: ${id}` });
    }
  }

  if (providers.chatgptOAuth) {
    for (const id of CHATGPT_MODEL_IDS) {
      options.push({ id: `chatgpt/${id}`, label: `ChatGPT: ${id}` });
    }
  }

  if (providers.anthropicOAuth) {
    for (const id of ANTHROPIC_OAUTH_MODEL_IDS) {
      options.push({ id: `anthropic-oauth/${id}`, label: `Claude: ${id}` });
    }
  }

  if (providers.openrouter) {
    options.push({ id: "free", label: "Free (OpenRouter)" });
    pushPiAiModels({
      options,
      provider: "openrouter",
      prefix: "openrouter/",
      labelPrefix: "OpenRouter: ",
    });
  }

  if (providers.openai) {
    pushPiAiModels({
      options,
      provider: "openai",
      prefix: "openai/",
      labelPrefix: "OpenAI: ",
    });
  }

  if (providers.anthropic) {
    pushPiAiModels({
      options,
      provider: "anthropic",
      prefix: "anthropic/",
      labelPrefix: "Anthropic: ",
    });
  }

  if (providers.google) {
    pushPiAiModels({
      options,
      provider: "google",
      prefix: "google/",
      labelPrefix: "Google: ",
    });
  }

  if (providers.xai) {
    pushPiAiModels({
      options,
      provider: "xai",
      prefix: "xai/",
      labelPrefix: "xAI: ",
    });
  }

  if (providers.zai) {
    pushPiAiModels({
      options,
      provider: "zai",
      prefix: "zai/",
      labelPrefix: "Z.AI: ",
    });
  }

  if (providers.nvidia) {
    const baseUrl = envState.nvidiaBaseUrl;
    const baseUrlHost = describeBaseUrlHost(baseUrl);
    if (baseUrlHost) {
      const discovered = await discoverOpenAiCompatibleModelIds({
        baseUrl,
        apiKey: envState.nvidiaApiKey,
        fetchImpl,
        timeoutMs: 1200,
      });
      for (const id of discovered) {
        options.push({ id: `nvidia/${id}`, label: `NVIDIA (${baseUrlHost}): ${id}` });
      }
    }
  }

  const openaiBaseUrl = (() => {
    return envState.providerBaseUrls.openai;
  })();

  let localModelsSource: { kind: "openai-compatible"; baseUrlHost: string } | null = null;

  if (
    openaiBaseUrl &&
    !isProbablyOpenRouterBaseUrl(openaiBaseUrl) &&
    !isProbablyZaiBaseUrl(openaiBaseUrl)
  ) {
    const baseUrlHost = describeBaseUrlHost(openaiBaseUrl);
    if (baseUrlHost) {
      const discovered = await discoverOpenAiCompatibleModelIds({
        baseUrl: openaiBaseUrl,
        apiKey: envState.apiKey,
        fetchImpl,
        timeoutMs: 900,
      });
      if (discovered.length > 0) {
        localModelsSource = { kind: "openai-compatible", baseUrlHost };
        for (const id of discovered) {
          options.push({ id: `openai/${id}`, label: `Local (${baseUrlHost}): ${id}` });
        }
      }
    }
  }

  return {
    ok: true,
    options: uniqById(options),
    providers,
    openaiBaseUrl,
    localModelsSource,
  };
}
