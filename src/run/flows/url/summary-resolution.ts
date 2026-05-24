import { isTwitterStatusUrl, isYouTubeUrl } from "@steipete/summarize-core/content/url";
import { countTokens } from "gpt-tokenizer";
import {
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
  buildSummaryCacheKey,
} from "../../../cache.js";
import type { ExtractedLinkContent } from "../../../content/index.js";
import { resolveGitHubModelsApiKey } from "../../../llm/github-models.js";
import type { Prompt } from "../../../llm/prompt.js";
import { buildAutoModelAttempts } from "../../../model-auto.js";
import { SUMMARY_SYSTEM_PROMPT } from "../../../prompts/index.js";
import {
  isClassificationOnlySummary,
  sanitizeSummaryMarkdown,
} from "../../../shared/summary-sanitizer.js";
import {
  readLastSuccessfulCliProvider,
  writeLastSuccessfulCliProvider,
} from "../../cli-fallback-state.js";
import { parseCliUserModelId } from "../../env.js";
import { writeVerbose } from "../../logging.js";
import { runModelAttempts } from "../../model-attempts.js";
import { buildOpenRouterNoAllowedProvidersMessage } from "../../openrouter.js";
import type { ModelAttempt } from "../../types.js";
import type { SlidesTerminalOutput } from "./slides-output.js";
import { normalizeSummarySlideHeadings } from "./slides-text.js";
import { buildModelMetaFromAttempt } from "./summary-finish.js";
import { assertUrlSummaryQuality, isUrlSummaryLanguageMismatchError } from "./summary-guards.js";
import { shouldBypassShortContentSummary } from "./summary-prompt.js";
import {
  ensureSummaryKeyMoments,
  resolveSummaryTimestampUpperBound,
  sanitizeSummaryKeyMoments,
  shouldSanitizeSummaryKeyMoments,
} from "./summary-timestamps.js";
import type { UrlFlowContext } from "./types.js";

type SlidesResult = Awaited<
  ReturnType<typeof import("../../../slides/index.js").extractSlidesForSource>
>;

type SummaryResolutionUseExtracted = {
  kind: "use-extracted";
  footerLabel: string;
  verboseMessage: string | null;
};

type SummaryResolutionSummary = {
  kind: "summary";
  normalizedSummary: string;
  summaryAlreadyPrinted: boolean;
  summaryFromCache: boolean;
  usedAttempt: ModelAttempt;
  modelMeta: ReturnType<typeof buildModelMetaFromAttempt>;
  maxOutputTokensForCall: number | null;
};

export type UrlSummaryResolution = SummaryResolutionUseExtracted | SummaryResolutionSummary;
type SummaryAttemptResult = Awaited<
  ReturnType<UrlFlowContext["model"]["summaryEngine"]["runSummaryAttempt"]>
>;

function buildLanguageRepairPrompt({
  markdown,
  languageLabel,
}: {
  markdown: string;
  languageLabel: string;
}): string {
  return [
    "<instructions>",
    `The Markdown summary below violated the requested output language. Rewrite it entirely in ${languageLabel}.`,
    "Preserve the same facts, Markdown structure, headings, bullets, links, and timestamps.",
    "Do not add new information, disclaimers, or commentary.",
    "Return only the corrected Markdown summary.",
    "</instructions>",
    "<summary>",
    markdown,
    "</summary>",
  ].join("\n");
}

async function repairSummaryLanguageIfPossible({
  error,
  summary,
  summaryAlreadyPrinted,
  summaryFromCache,
  outputLanguage,
  usedAttempt,
  model,
  onModelChosen,
}: {
  error: unknown;
  summary: string;
  summaryAlreadyPrinted: boolean;
  summaryFromCache: boolean;
  outputLanguage: UrlFlowContext["flags"]["outputLanguage"];
  usedAttempt: ModelAttempt;
  model: UrlFlowContext["model"];
  onModelChosen?: ((modelId: string) => void) | null;
}): Promise<SummaryAttemptResult | null> {
  if (!isUrlSummaryLanguageMismatchError(error)) return null;
  if (summaryAlreadyPrinted || summaryFromCache || outputLanguage.kind !== "fixed") return null;

  const repairPrompt: Prompt = {
    system: SUMMARY_SYSTEM_PROMPT,
    userText: buildLanguageRepairPrompt({
      markdown: summary,
      languageLabel: outputLanguage.label,
    }),
  };

  return await model.summaryEngine.runSummaryAttempt({
    attempt: usedAttempt,
    prompt: repairPrompt,
    allowStreaming: false,
    onModelChosen: onModelChosen ?? null,
    streamHandler: null,
  });
}

export async function resolveUrlSummaryExecution({
  ctx,
  url,
  extracted,
  prompt,
  onModelChosen,
  slides,
  slidesOutput,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  prompt: string;
  onModelChosen?: ((modelId: string) => void) | null;
  slides?: SlidesResult | null;
  slidesOutput?: SlidesTerminalOutput | null;
}): Promise<UrlSummaryResolution> {
  const { io, flags, model, cache: cacheState } = ctx;
  ctx.perfTrace?.mark("summary:resolve-start");
  const lastSuccessfulCliProvider = model.isFallbackModel
    ? await readLastSuccessfulCliProvider(io.envForRun)
    : null;

  const promptPayload: Prompt = { system: SUMMARY_SYSTEM_PROMPT, userText: prompt };
  const promptTokens = countTokens(promptPayload.userText);
  const kindForAuto =
    extracted.siteName === "YouTube" ? ("youtube" as const) : ("website" as const);
  const hasSlides = Boolean(slides && slides.slides.length > 0);
  const sanitizeKeyMoments = shouldSanitizeSummaryKeyMoments({ extracted, hasSlides });
  const timestampUpperBound = sanitizeKeyMoments
    ? resolveSummaryTimestampUpperBound(extracted)
    : null;
  const assertSummaryQuality = (markdown: string, sourceLabel: string) =>
    assertUrlSummaryQuality({
      markdown,
      outputLanguage: flags.outputLanguage,
      lengthArg: flags.lengthArg,
      hasSlides,
      promptOverride: flags.promptOverride,
      sourceLabel,
    });
  const isUsableCachedSummary = (markdown: string): boolean => {
    if (isClassificationOnlySummary(markdown)) return false;
    try {
      assertSummaryQuality(markdown, "Cached summary");
      return true;
    } catch (error) {
      writeVerbose(
        io.stderr,
        flags.verbose,
        `cache skip summary: ${error instanceof Error ? error.message : String(error)}`,
        flags.verboseColor,
        io.envForRun,
      );
      return false;
    }
  };

  const attempts: ModelAttempt[] = await (async () => {
    if (model.isFallbackModel) {
      const catalog = await model.getLiteLlmCatalog();
      const list = buildAutoModelAttempts({
        kind: kindForAuto,
        promptTokens,
        desiredOutputTokens: model.desiredOutputTokens,
        requiresVideoUnderstanding: false,
        env: model.envForAuto,
        config: model.configForModelSelection,
        catalog,
        openrouterProvidersFromEnv: null,
        cliAvailability: model.cliAvailability,
        isImplicitAutoSelection: model.isImplicitAutoSelection,
        allowAutoCliFallback: model.allowAutoCliFallback,
        lastSuccessfulCliProvider,
      });
      if (flags.verbose) {
        for (const attempt of list.slice(0, 8)) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            `auto candidate ${attempt.debug}`,
            flags.verboseColor,
            io.envForRun,
          );
        }
      }
      return list.map((attempt) => {
        if (attempt.transport !== "cli")
          return model.summaryEngine.applyOpenAiGatewayOverrides(attempt as ModelAttempt);
        const parsed = parseCliUserModelId(attempt.userModelId);
        return { ...attempt, cliProvider: parsed.provider, cliModel: parsed.model };
      });
    }
    /* v8 ignore next */
    if (!model.fixedModelSpec) {
      throw new Error("Internal error: missing fixed model spec");
    }
    if (model.fixedModelSpec.transport === "cli") {
      return [
        {
          transport: "cli",
          userModelId: model.fixedModelSpec.userModelId,
          llmModelId: null,
          cliProvider: model.fixedModelSpec.cliProvider,
          cliModel: model.fixedModelSpec.cliModel,
          openrouterProviders: null,
          forceOpenRouter: false,
          requiredEnv: model.fixedModelSpec.requiredEnv,
        },
      ];
    }
    const openaiOverrides =
      model.fixedModelSpec.requiredEnv === "Z_AI_API_KEY"
        ? {
            openaiApiKeyOverride: model.apiStatus.zaiApiKey,
            openaiBaseUrlOverride: model.apiStatus.zaiBaseUrl,
            forceChatCompletions: true,
          }
        : model.fixedModelSpec.requiredEnv === "NVIDIA_API_KEY"
          ? {
              openaiApiKeyOverride: model.apiStatus.nvidiaApiKey,
              openaiBaseUrlOverride: model.apiStatus.nvidiaBaseUrl,
              forceChatCompletions: true,
            }
          : model.fixedModelSpec.requiredEnv === "GITHUB_TOKEN"
            ? {
                openaiApiKeyOverride: resolveGitHubModelsApiKey(io.envForRun),
                openaiBaseUrlOverride: model.fixedModelSpec.openaiBaseUrlOverride ?? null,
                forceChatCompletions: true,
              }
            : {};
    return [
      {
        transport: model.fixedModelSpec.transport === "openrouter" ? "openrouter" : "native",
        userModelId: model.fixedModelSpec.userModelId,
        llmModelId: model.fixedModelSpec.llmModelId,
        openrouterProviders: model.fixedModelSpec.openrouterProviders,
        forceOpenRouter: model.fixedModelSpec.forceOpenRouter,
        requiredEnv: model.fixedModelSpec.requiredEnv,
        ...(model.fixedModelSpec.requestOptions
          ? { requestOptions: model.fixedModelSpec.requestOptions }
          : {}),
        ...openaiOverrides,
      },
    ];
  })();
  ctx.perfTrace?.mark("summary:attempts", attempts[0]?.userModelId ?? null);

  const cacheStore =
    cacheState.mode === "default" && !flags.summaryCacheBypass ? cacheState.store : null;
  const contentHash = cacheStore
    ? buildPromptContentHash({ prompt, fallbackContent: extracted.content })
    : null;
  const promptHash = cacheStore ? buildPromptHash(prompt) : null;
  const lengthKey = buildLengthKey(flags.lengthArg);
  const languageKey = buildLanguageKey(flags.outputLanguage);
  const autoSelectionCacheModel = model.isFallbackModel
    ? `selection:${model.requestedModelInput.toLowerCase()}`
    : null;

  let summaryResult: Awaited<ReturnType<typeof model.summaryEngine.runSummaryAttempt>> | null =
    null;
  let usedAttempt: ModelAttempt | null = null;
  let summaryFromCache = false;
  let cacheChecked = false;

  const isTweet = extracted.siteName?.toLowerCase() === "x" || isTwitterStatusUrl(extracted.url);
  const isYouTube = extracted.siteName === "YouTube" || isYouTubeUrl(url);
  const hasMedia =
    Boolean(extracted.video) ||
    (extracted.transcriptSource != null && extracted.transcriptSource !== "unavailable") ||
    (typeof extracted.mediaDurationSeconds === "number" && extracted.mediaDurationSeconds > 0) ||
    extracted.isVideoOnly === true;
  const autoBypass = ctx.model.isFallbackModel && !ctx.model.isNamedModelSelection;
  const canBypassShortContent =
    (autoBypass || isTweet) &&
    !flags.slides &&
    !hasMedia &&
    flags.streamMode !== "on" &&
    !isYouTube &&
    shouldBypassShortContentSummary({
      extracted,
      lengthArg: flags.lengthArg,
      forceSummary: flags.forceSummary,
      maxOutputTokensArg: flags.maxOutputTokensArg,
      json: flags.json,
      countTokens,
    });

  if (canBypassShortContent) {
    return {
      kind: "use-extracted",
      footerLabel: "short content",
      verboseMessage: "short content: skipping summary",
    };
  }

  if (cacheStore && contentHash && promptHash) {
    cacheChecked = true;
    if (autoSelectionCacheModel) {
      const key = buildSummaryCacheKey({
        contentHash,
        promptHash,
        model: autoSelectionCacheModel,
        lengthKey,
        languageKey,
      });
      const cached = cacheStore.getJson<{ summary?: unknown; model?: unknown }>("summary", key);
      const cachedSummary =
        cached && typeof cached.summary === "string"
          ? sanitizeSummaryMarkdown(cached.summary)
          : null;
      const cachedModelId = cached && typeof cached.model === "string" ? cached.model.trim() : null;
      if (cachedSummary && isUsableCachedSummary(cachedSummary)) {
        const cachedAttempt = cachedModelId
          ? (attempts.find((attempt) => attempt.userModelId === cachedModelId) ?? null)
          : null;
        const fallbackAttempt =
          attempts.find((attempt) => model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) ??
          attempts[0] ??
          null;
        const matchedAttempt =
          cachedAttempt && model.summaryEngine.envHasKeyFor(cachedAttempt.requiredEnv)
            ? cachedAttempt
            : fallbackAttempt;
        if (matchedAttempt) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            "cache hit summary (auto selection)",
            flags.verboseColor,
            io.envForRun,
          );
          onModelChosen?.(cachedModelId || matchedAttempt.userModelId);
          summaryResult = {
            summary: cachedSummary,
            summaryAlreadyPrinted: false,
            modelMeta: buildModelMetaFromAttempt(matchedAttempt),
            maxOutputTokensForCall: null,
          };
          usedAttempt = matchedAttempt;
          summaryFromCache = true;
        }
      }
    }
    if (!summaryFromCache) {
      for (const attempt of attempts) {
        if (!model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) continue;
        const key = buildSummaryCacheKey({
          contentHash,
          promptHash,
          model: attempt.userModelId,
          lengthKey,
          languageKey,
        });
        const cachedRaw = cacheStore.getText("summary", key);
        const cached = cachedRaw ? sanitizeSummaryMarkdown(cachedRaw) : null;
        if (!cached || !isUsableCachedSummary(cached)) continue;
        writeVerbose(
          io.stderr,
          flags.verbose,
          "cache hit summary",
          flags.verboseColor,
          io.envForRun,
        );
        onModelChosen?.(attempt.userModelId);
        summaryResult = {
          summary: cached,
          summaryAlreadyPrinted: false,
          modelMeta: buildModelMetaFromAttempt(attempt),
          maxOutputTokensForCall: null,
        };
        usedAttempt = attempt;
        summaryFromCache = true;
        break;
      }
    }
  }
  if (cacheChecked && !summaryFromCache) {
    writeVerbose(io.stderr, flags.verbose, "cache miss summary", flags.verboseColor, io.envForRun);
  }
  ctx.hooks.onSummaryCached?.(summaryFromCache);
  ctx.perfTrace?.mark(summaryFromCache ? "summary:cache-hit" : "summary:cache-miss");

  let lastError: unknown = null;
  let missingRequiredEnvs = new Set<ModelAttempt["requiredEnv"]>();
  let sawOpenRouterNoAllowedProviders = false;

  if (!summaryResult || !usedAttempt) {
    const attemptOutcome = await runModelAttempts({
      attempts,
      isFallbackModel: model.isFallbackModel,
      isNamedModelSelection: model.isNamedModelSelection,
      envHasKeyFor: model.summaryEngine.envHasKeyFor,
      formatMissingModelError: model.summaryEngine.formatMissingModelError,
      onAutoSkip: (attempt) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto skip ${attempt.userModelId}: missing ${attempt.requiredEnv}`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onAutoFailure: (attempt, error) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto failed ${attempt.userModelId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onFixedModelError: (_attempt, error) => {
        throw error;
      },
      runAttempt: (attempt) =>
        model.summaryEngine.runSummaryAttempt({
          attempt,
          prompt: promptPayload,
          allowStreaming: flags.streamingEnabled && !sanitizeKeyMoments,
          onModelChosen: onModelChosen ?? null,
          streamHandler: slidesOutput?.streamHandler ?? null,
        }),
    });
    summaryResult = attemptOutcome.result;
    usedAttempt = attemptOutcome.usedAttempt;
    lastError = attemptOutcome.lastError;
    missingRequiredEnvs = attemptOutcome.missingRequiredEnvs;
    sawOpenRouterNoAllowedProviders = attemptOutcome.sawOpenRouterNoAllowedProviders;
  }

  if (!summaryResult || !usedAttempt) {
    const withFreeTip = (message: string) => {
      if (!model.isNamedModelSelection || !model.wantsFreeNamedModel) return message;
      return (
        `${message}\n` +
        `Tip: run "summarize refresh-free" to refresh the free model candidates (writes ~/.summarize/config.json).`
      );
    };

    if (model.isNamedModelSelection) {
      if (lastError === null && missingRequiredEnvs.size > 0) {
        throw new Error(
          withFreeTip(
            `Missing ${Array.from(missingRequiredEnvs).sort().join(", ")} for --model ${model.requestedModelInput}.`,
          ),
        );
      }
      if (lastError instanceof Error) {
        if (sawOpenRouterNoAllowedProviders) {
          const message = await buildOpenRouterNoAllowedProvidersMessage({
            attempts,
            fetchImpl: io.fetch,
            timeoutMs: flags.timeoutMs,
          });
          throw new Error(withFreeTip(message), { cause: lastError });
        }
        throw new Error(withFreeTip(lastError.message), { cause: lastError });
      }
      throw new Error(withFreeTip(`No model available for --model ${model.requestedModelInput}`));
    }
    return {
      kind: "use-extracted",
      footerLabel: "no model",
      verboseMessage:
        lastError instanceof Error ? `auto failed all models: ${lastError.message}` : null,
    };
  }

  let { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;
  let normalizedSummaryBase =
    slides && slides.slides.length > 0 ? normalizeSummarySlideHeadings(summary) : summary;
  try {
    assertSummaryQuality(normalizedSummaryBase, "LLM");
  } catch (error) {
    const repaired = await repairSummaryLanguageIfPossible({
      error,
      summary: normalizedSummaryBase,
      summaryAlreadyPrinted,
      summaryFromCache,
      outputLanguage: flags.outputLanguage,
      usedAttempt,
      model,
      onModelChosen,
    });
    if (!repaired) throw error;
    summary = repaired.summary;
    summaryAlreadyPrinted = repaired.summaryAlreadyPrinted;
    modelMeta = repaired.modelMeta;
    maxOutputTokensForCall = repaired.maxOutputTokensForCall;
    normalizedSummaryBase =
      slides && slides.slides.length > 0 ? normalizeSummarySlideHeadings(summary) : summary;
    assertSummaryQuality(normalizedSummaryBase, "LLM language repair");
  }
  const sanitizedSummary = sanitizeSummaryKeyMoments({
    markdown: normalizedSummaryBase,
    maxSeconds: timestampUpperBound,
  });
  const normalizedSummary = ensureSummaryKeyMoments({
    markdown: sanitizedSummary,
    extracted,
    maxSeconds: timestampUpperBound,
    outputLanguage: flags.outputLanguage,
  });

  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const perModelKey = buildSummaryCacheKey({
      contentHash,
      promptHash,
      model: usedAttempt.userModelId,
      lengthKey,
      languageKey,
    });
    cacheStore.setText("summary", perModelKey, normalizedSummary, cacheState.ttlMs);
    writeVerbose(io.stderr, flags.verbose, "cache write summary", flags.verboseColor, io.envForRun);
    if (autoSelectionCacheModel) {
      const selectionKey = buildSummaryCacheKey({
        contentHash,
        promptHash,
        model: autoSelectionCacheModel,
        lengthKey,
        languageKey,
      });
      cacheStore.setJson(
        "summary",
        selectionKey,
        { summary: normalizedSummary, model: usedAttempt.userModelId },
        cacheState.ttlMs,
      );
      writeVerbose(
        io.stderr,
        flags.verbose,
        "cache write summary (auto selection)",
        flags.verboseColor,
        io.envForRun,
      );
    }
  }
  if (
    !summaryFromCache &&
    model.isFallbackModel &&
    usedAttempt.transport === "cli" &&
    usedAttempt.cliProvider
  ) {
    await writeLastSuccessfulCliProvider({
      env: io.envForRun,
      provider: usedAttempt.cliProvider,
    });
  }

  return {
    kind: "summary",
    normalizedSummary,
    summaryAlreadyPrinted,
    summaryFromCache,
    usedAttempt,
    modelMeta,
    maxOutputTokensForCall,
  };
}
