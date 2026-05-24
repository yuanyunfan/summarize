import type { Api, Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import { isOpenRouterBaseUrl } from "@steipete/summarize-core";
import { createSyntheticModel } from "../llm/providers/shared.js";
import { buildAutoModelAttempts, envHasKey } from "../model-auto.js";
import { parseBooleanEnv, parseCliUserModelId } from "../run/env.js";
import { resolveRunContextState } from "../run/run-context.js";
import { resolveModelSelection } from "../run/run-models.js";
import { resolveRunOverrides } from "../run/run-settings.js";

type AgentApiKeys = {
  openaiApiKey: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
  googleApiKey: string | null;
  xaiApiKey: string | null;
  zaiApiKey: string | null;
  nvidiaApiKey: string | null;
};

const REQUIRED_ENV_BY_PROVIDER: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  zai: "Z_AI_API_KEY",
};

function parseProviderModelId(modelId: string): { provider: string; model: string } {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { provider: "openai", model: trimmed };
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function isCustomOpenAiBaseUrl(baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host !== "api.openai.com";
  } catch {
    return false;
  }
}

function overrideModelGatewaySettings({
  provider,
  model,
  baseUrl,
  openAiChatCompletionsPreference,
}: {
  provider: string;
  model: Model<Api>;
  baseUrl: string | null;
  openAiChatCompletionsPreference: boolean | null;
}) {
  const nextModel = baseUrl ? ({ ...model, baseUrl } as Model<Api>) : model;
  if (provider !== "openai") return nextModel;
  const effectiveBaseUrl =
    typeof nextModel.baseUrl === "string" && nextModel.baseUrl.trim().length > 0
      ? nextModel.baseUrl.trim()
      : null;
  const shouldUseChatCompletions =
    openAiChatCompletionsPreference === true ||
    (effectiveBaseUrl !== null && isOpenRouterBaseUrl(effectiveBaseUrl)) ||
    (openAiChatCompletionsPreference !== false && isCustomOpenAiBaseUrl(effectiveBaseUrl));
  if (shouldUseChatCompletions) {
    const headers =
      effectiveBaseUrl !== null && isOpenRouterBaseUrl(effectiveBaseUrl)
        ? {
            ...((nextModel as Model<Api> & { headers?: Record<string, string> }).headers ?? {}),
            "HTTP-Referer": "https://github.com/steipete/summarize",
            "X-Title": "summarize",
          }
        : (nextModel as Model<Api> & { headers?: Record<string, string> }).headers;
    return {
      ...nextModel,
      api: "openai-completions",
      ...(headers ? { headers } : {}),
    } as Model<Api>;
  }
  if (openAiChatCompletionsPreference === false) {
    return {
      ...nextModel,
      api: "openai-responses",
    } as Model<Api>;
  }
  return nextModel;
}

function resolveOpenAiChatCompletionsPreference({
  env,
  config,
}: {
  env: Record<string, string | undefined>;
  config: ReturnType<typeof resolveRunContextState>["config"];
}): boolean | null {
  const envValue = parseBooleanEnv(env.OPENAI_USE_CHAT_COMPLETIONS);
  if (envValue !== null) return envValue;
  const configValue = config?.openai?.useChatCompletions;
  return typeof configValue === "boolean" ? configValue : null;
}

function resolveSyntheticOpenAiApi({
  baseUrl,
  openAiChatCompletionsPreference,
}: {
  baseUrl: string;
  openAiChatCompletionsPreference: boolean | null;
}): Model<Api>["api"] {
  if (isOpenRouterBaseUrl(baseUrl)) return "openai-completions";
  if (openAiChatCompletionsPreference === false) return "openai-responses";
  return "openai-completions";
}

function resolveModelWithFallback({
  provider,
  modelId,
  baseUrl,
  openAiChatCompletionsPreference,
  allowImages,
}: {
  provider: string;
  modelId: string;
  baseUrl: string | null;
  openAiChatCompletionsPreference: boolean | null;
  allowImages: boolean;
}): Model<Api> {
  try {
    const model = getModel(provider as never, modelId as never);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    return overrideModelGatewaySettings({
      provider,
      model: model as Model<Api>,
      baseUrl,
      openAiChatCompletionsPreference,
    });
  } catch (error) {
    if (baseUrl) {
      return createSyntheticModel({
        provider: provider as never,
        modelId,
        api:
          provider === "openai"
            ? resolveSyntheticOpenAiApi({ baseUrl, openAiChatCompletionsPreference })
            : "openai-completions",
        baseUrl,
        allowImages,
      });
    }
    if (provider === "openrouter") {
      return createSyntheticModel({
        provider: "openrouter",
        modelId,
        api: "openai-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        allowImages,
      });
    }
    throw error;
  }
}

export function resolveApiKeyForModel({
  provider,
  apiKeys,
}: {
  provider: string;
  apiKeys: AgentApiKeys;
}): string {
  const resolved = (() => {
    switch (provider) {
      case "openrouter":
        return apiKeys.openrouterApiKey;
      case "openai":
        return apiKeys.openaiApiKey;
      case "nvidia":
        return apiKeys.nvidiaApiKey;
      case "anthropic":
        return apiKeys.anthropicApiKey;
      case "google":
        return apiKeys.googleApiKey;
      case "xai":
        return apiKeys.xaiApiKey;
      case "zai":
        return apiKeys.zaiApiKey;
      default:
        return null;
    }
  })();

  if (resolved) return resolved;
  const requiredEnv = REQUIRED_ENV_BY_PROVIDER[provider];
  if (requiredEnv) {
    throw new Error(`Missing ${requiredEnv} for ${provider} model`);
  }
  throw new Error(`Missing API key for provider: ${provider}`);
}

function buildNoAgentModelAvailableError({
  attempts,
  envForAuto,
  cliAvailability,
}: {
  attempts: Array<{
    transport: "native" | "openrouter" | "cli";
    userModelId: string;
    requiredEnv: string;
  }>;
  envForAuto: Record<string, string | undefined>;
  cliAvailability: {
    claude?: boolean;
    codex?: boolean;
    gemini?: boolean;
    agent?: boolean;
    openclaw?: boolean;
    opencode?: boolean;
  };
}): Error {
  const checked = attempts.map((attempt) => attempt.userModelId);
  const missingEnv = Array.from(
    new Set(
      attempts
        .filter((attempt) => attempt.transport !== "cli")
        .map((attempt) => attempt.requiredEnv)
        .filter((requiredEnv) => !envHasKey(envForAuto, requiredEnv as never)),
    ),
  );
  const unavailableCli = Array.from(
    new Set(
      attempts
        .filter((attempt) => attempt.transport === "cli")
        .map((attempt) => {
          if (attempt.requiredEnv === "CLI_CLAUDE") return "claude";
          if (attempt.requiredEnv === "CLI_CODEX") return "codex";
          if (attempt.requiredEnv === "CLI_GEMINI") return "gemini";
          if (attempt.requiredEnv === "CLI_AGENT") return "agent";
          if (attempt.requiredEnv === "CLI_OPENCLAW") return "openclaw";
          if (attempt.requiredEnv === "CLI_COPILOT") return "copilot";
          return "opencode";
        })
        .filter((provider) => !cliAvailability[provider as keyof typeof cliAvailability]),
    ),
  );

  const details = [
    "No model available for agent.",
    checked.length > 0 ? `Checked: ${checked.join(", ")}.` : null,
    missingEnv.length > 0 ? `Missing env: ${missingEnv.join(", ")}.` : null,
    unavailableCli.length > 0 ? `CLI unavailable: ${unavailableCli.join(", ")}.` : null,
    "Restart or reinstall the daemon after changing API keys or CLI installs so its saved environment updates.",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return new Error(details);
}

export async function resolveAgentModel({
  env,
  pageContent,
  modelOverride,
  hasImageInputs = false,
}: {
  env: Record<string, string | undefined>;
  pageContent: string;
  modelOverride: string | null;
  hasImageInputs?: boolean;
}) {
  const {
    config,
    configPath,
    configForCli,
    apiKey,
    openrouterApiKey,
    anthropicApiKey,
    googleApiKey,
    xaiApiKey,
    zaiApiKey,
    providerBaseUrls,
    zaiBaseUrl,
    nvidiaApiKey,
    nvidiaBaseUrl,
    envForAuto,
    cliAvailability,
  } = resolveRunContextState({
    env,
    envForRun: env,
    programOpts: { videoMode: "auto" },
    languageExplicitlySet: false,
    videoModeExplicitlySet: false,
    cliFlagPresent: false,
    cliProviderArg: null,
  });

  const apiKeys: AgentApiKeys = {
    openaiApiKey: apiKey,
    openrouterApiKey,
    anthropicApiKey,
    googleApiKey,
    xaiApiKey,
    zaiApiKey,
    nvidiaApiKey,
  };

  const overrides = resolveRunOverrides({});
  const maxOutputTokens = overrides.maxOutputTokensArg ?? 2048;
  const openAiChatCompletionsPreference = resolveOpenAiChatCompletionsPreference({ env, config });

  const { requestedModel, configForModelSelection, isFallbackModel } = resolveModelSelection({
    config,
    configForCli,
    configPath,
    envForRun: env,
    explicitModelArg: modelOverride,
  });

  const providerBaseUrlMap: Record<string, string | null> = {
    openai: providerBaseUrls.openai,
    anthropic: providerBaseUrls.anthropic,
    google: providerBaseUrls.google,
    xai: providerBaseUrls.xai,
    zai: zaiBaseUrl,
    nvidia: nvidiaBaseUrl,
  };

  const applyBaseUrlOverride = (provider: string, modelId: string) => {
    const baseUrl = providerBaseUrlMap[provider] ?? null;
    const providerForPiAi = provider === "nvidia" ? "openai" : provider;
    return {
      provider,
      model: resolveModelWithFallback({
        provider: providerForPiAi,
        modelId,
        baseUrl,
        openAiChatCompletionsPreference:
          provider === "openai" ? openAiChatCompletionsPreference : null,
        allowImages: hasImageInputs,
      }),
    };
  };

  if (requestedModel.kind === "fixed") {
    if (requestedModel.transport === "cli") {
      return {
        provider: "cli",
        model: null,
        maxOutputTokens,
        apiKeys,
        transport: "cli" as const,
        cliProvider: requestedModel.cliProvider,
        cliModel: requestedModel.cliModel,
        userModelId: requestedModel.userModelId,
        cliConfig: configForCli?.cli ?? null,
      };
    }
    if (requestedModel.transport === "openrouter") {
      const resolved = applyBaseUrlOverride("openrouter", requestedModel.openrouterModelId);
      return { ...resolved, maxOutputTokens, apiKeys };
    }

    const { provider, model } = parseProviderModelId(requestedModel.llmModelId);
    const resolved = applyBaseUrlOverride(provider, model);
    return { ...resolved, maxOutputTokens, apiKeys };
  }

  if (!isFallbackModel) {
    throw buildNoAgentModelAvailableError({ attempts: [], envForAuto, cliAvailability });
  }

  const estimatedPromptTokens = Math.ceil(pageContent.length / 4);
  const attempts = buildAutoModelAttempts({
    kind: hasImageInputs ? "image" : "website",
    promptTokens: hasImageInputs ? null : estimatedPromptTokens,
    desiredOutputTokens: maxOutputTokens,
    requiresVideoUnderstanding: false,
    env: envForAuto,
    config: configForModelSelection,
    catalog: null,
    openrouterProvidersFromEnv: null,
    cliAvailability,
  });

  let cliAttempt: (typeof attempts)[number] | null = null;
  for (const attempt of attempts) {
    if (attempt.transport === "cli") {
      if (!cliAttempt) cliAttempt = attempt;
      continue;
    }
    if (!envHasKey(envForAuto, attempt.requiredEnv)) continue;
    if (attempt.transport === "openrouter") {
      const modelId = attempt.userModelId.replace(/^openrouter\//i, "");
      const resolved = applyBaseUrlOverride("openrouter", modelId);
      return { ...resolved, maxOutputTokens, apiKeys };
    }
    if (!attempt.llmModelId) continue;
    const { provider, model } = parseProviderModelId(attempt.llmModelId);
    const resolved = applyBaseUrlOverride(provider, model);
    return { ...resolved, maxOutputTokens, apiKeys };
  }

  if (cliAttempt) {
    const parsed = parseCliUserModelId(cliAttempt.userModelId);
    if (!cliAvailability[parsed.provider]) {
      throw buildNoAgentModelAvailableError({ attempts, envForAuto, cliAvailability });
    }
    return {
      provider: "cli",
      model: null,
      maxOutputTokens,
      apiKeys,
      transport: "cli" as const,
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      userModelId: cliAttempt.userModelId,
      cliConfig: configForCli?.cli ?? null,
    };
  }

  throw buildNoAgentModelAvailableError({ attempts, envForAuto, cliAvailability });
}
