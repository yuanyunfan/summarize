import type { Api, AssistantMessage, Model, Tool } from "@earendil-works/pi-ai";
import { completeSimple, streamSimple } from "@earendil-works/pi-ai";
import { buildPromptHash } from "../cache.js";
import {
  createChatOutputStreamSanitizer,
  sanitizeChatAssistantMessage,
  sanitizeChatAssistantText,
} from "../shared/chat-output-sanitizer.js";
import { resolveAgentModel, resolveApiKeyForModel } from "./agent-model.js";
import {
  buildSystemPrompt,
  flattenAgentForCli,
  getAgentPrompt,
  hasImageContent,
  normalizeMessages,
  resolveToolList,
} from "./agent-request.js";
import { isUnsupportedResponsesApiError } from "./openai-api-errors.js";

export function buildAgentPromptHash(automationEnabled: boolean): string {
  return buildPromptHash(getAgentPrompt(automationEnabled));
}

const TOOL_DEFINITIONS: Record<string, Tool> = {
  navigate: {
    name: "navigate",
    description:
      "Navigate the active tab to a URL, list open tabs, or switch tabs. Use this for ALL navigation. Never use window.location/history in code.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        newTab: { type: "boolean", description: "Open in a new tab", default: false },
        listTabs: { type: "boolean", description: "List open tabs in the current window" },
        switchToTab: { type: "number", description: "Tab ID to switch to" },
      },
    } as unknown as Tool["parameters"],
  },
  repl: {
    name: "repl",
    description:
      "Execute JavaScript in a sandbox. Helpers: browserjs(fn), navigate(), sleep(ms), returnFile(), createOrUpdateArtifact(), getArtifact(), listArtifacts(), deleteArtifact().",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Short description of the code intent" },
        code: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["title", "code"],
    } as unknown as Tool["parameters"],
  },
  ask_user_which_element: {
    name: "ask_user_which_element",
    description: "Ask the user to click the desired element in the page.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string", description: "Optional instruction shown to the user" },
      },
    } as unknown as Tool["parameters"],
  },
  skill: {
    name: "skill",
    description:
      "Create, update, list, or delete domain-specific automation libraries that auto-inject into browserjs().",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["get", "list", "create", "rewrite", "update", "delete"],
          description: "Action to perform",
        },
        name: {
          type: "string",
          description: "Skill name (required for get/rewrite/update/delete)",
        },
        url: {
          type: "string",
          description:
            "URL to filter skills by (optional for list action; defaults to current tab)",
        },
        includeLibraryCode: {
          type: "boolean",
          description:
            "Use with get action to include library code in output (only needed when editing library code).",
        },
        data: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "Unique skill name" },
            domainPatterns: {
              type: "array",
              items: { type: "string" },
              description:
                'Glob-like domain patterns (e.g., ["github.com", "github.com/*/issues"])',
            },
            shortDescription: { type: "string", description: "One-line description" },
            description: { type: "string", description: "Full markdown description" },
            examples: { type: "string", description: "Plain JavaScript examples" },
            library: { type: "string", description: "JavaScript library code to inject" },
          },
        },
        updates: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
            shortDescription: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
            domainPatterns: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
            description: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
            examples: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
            library: {
              type: "object",
              properties: {
                old_string: { type: "string" },
                new_string: { type: "string" },
              },
            },
          },
        },
      },
      required: ["action"],
    } as unknown as Tool["parameters"],
  },
  artifacts: {
    name: "artifacts",
    description:
      "Create, read, update, list, or delete session artifacts (notes, CSVs, JSON, binary files).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "create", "update", "delete"],
          description: "Action to perform",
        },
        fileName: {
          type: "string",
          description: "Artifact filename (required for get/create/update/delete)",
        },
        content: {
          type: "string",
          description:
            "Text content to store. For JSON/arrays/numbers/booleans/null, pass serialized JSON as a string.",
        },
        mimeType: { type: "string", description: "Optional MIME type override" },
        contentBase64: { type: "string", description: "Base64 payload for binary files" },
        asBase64: {
          type: "boolean",
          description: "Return base64 payload for get action instead of parsed text/JSON",
        },
      },
      required: ["action"],
    } as unknown as Tool["parameters"],
  },
  summarize: {
    name: "summarize",
    description:
      "Run Summarize on a URL (summary or extract-only). Use extractOnly + format=markdown to return Markdown.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "URL to summarize (defaults to active tab)" },
        extractOnly: {
          type: "boolean",
          description: "Extract content only (no summary)",
          default: false,
        },
        format: {
          type: "string",
          enum: ["text", "markdown"],
          description: "Extraction format when extractOnly is true (default: text)",
        },
        markdownMode: {
          type: "string",
          enum: ["off", "auto", "llm", "readability"],
          description: "Markdown conversion mode (only when format=markdown)",
        },
        model: { type: "string", description: "Model override (e.g. openai/gpt-5-mini)" },
        length: { type: "string", description: "Summary length (short|medium|long|xl|...)" },
        language: { type: "string", description: "Output language (auto or tag)" },
        prompt: { type: "string", description: "Prompt override" },
        timeout: { type: "string", description: "Timeout (e.g. 30s, 2m)" },
        maxOutputTokens: { type: "string", description: "Max output tokens (e.g. 2k)" },
        noCache: { type: "boolean", description: "Bypass cache" },
        firecrawl: {
          type: "string",
          enum: ["off", "auto", "always"],
          description: "Firecrawl mode",
        },
        preprocess: {
          type: "string",
          enum: ["off", "auto", "always"],
          description: "Preprocess/markitdown mode",
        },
        youtube: {
          type: "string",
          enum: ["auto", "web", "yt-dlp", "apify", "no-auto"],
          description: "YouTube transcript mode",
        },
        videoMode: {
          type: "string",
          enum: ["auto", "transcript", "understand"],
          description: "Video mode",
        },
        timestamps: { type: "boolean", description: "Include transcript timestamps" },
        forceSummary: {
          type: "boolean",
          description: "Force LLM summary even when content is shorter than requested length",
        },
        maxCharacters: { type: "number", description: "Max characters for extraction" },
      },
    } as unknown as Tool["parameters"],
  },
  debugger: {
    name: "debugger",
    description:
      "Run JavaScript in the main world via the Chrome debugger. LAST RESORT; shows a banner to the user.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["eval"],
          description: "Action to perform",
        },
        code: { type: "string", description: "JavaScript to evaluate in the main world" },
      },
      required: ["action", "code"],
    } as unknown as Tool["parameters"],
  },
};

function isOpenAiResponsesModel(model: unknown): boolean {
  return (
    typeof model === "object" &&
    model !== null &&
    (model as { api?: unknown }).api === "openai-responses"
  );
}

function withOpenAiChatCompletionsModel<T>(model: T): T {
  if (typeof model !== "object" || model === null) return model;
  return {
    ...model,
    api: "openai-completions",
  } as T;
}

function normalizeAgentStreamError(error: unknown): Error {
  if (error instanceof Error) return error;
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message =
    typeof record.errorMessage === "string" && record.errorMessage.trim().length > 0
      ? record.errorMessage
      : "Agent stream failed.";
  const next = new Error(message);
  if (typeof record.responseBody === "string") {
    (next as { responseBody?: string }).responseBody = record.responseBody;
  }
  if (typeof record.code === "string") {
    (next as { code?: string }).code = record.code;
  }
  return next;
}

function stringifyErrorPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errorDetails(error: unknown): string {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message = error instanceof Error ? error.message : stringifyErrorPart(error);
  const body = stringifyErrorPart(record.responseBody);
  const code = stringifyErrorPart(record.code);
  const errorMessage = stringifyErrorPart(record.errorMessage);
  return [message, body, code, errorMessage].filter(Boolean).join("\n");
}

function isAutoModelOverride(modelOverride: string | null): boolean {
  return !modelOverride || modelOverride.trim().toLowerCase() === "auto";
}

function shouldRetryRequestWithAutoModel({
  error,
  hasImageInputs,
  modelOverride,
}: {
  error: unknown;
  hasImageInputs: boolean;
  modelOverride: string | null;
}): boolean {
  if (isAutoModelOverride(modelOverride)) return false;
  if (/model_not_supported|requested model is not supported/i.test(errorDetails(error)))
    return true;
  if (!hasImageInputs) return false;
  if (isUnsupportedResponsesApiError(error)) return true;
  return false;
}

function ensureImageCapableAgentModel({
  model,
  provider,
  hasImageInputs,
}: {
  model: Model<Api>;
  provider: string;
  hasImageInputs: boolean;
}) {
  if (!hasImageInputs || model.input.includes("image")) return;
  const modelId = `${provider}/${model.id}`;
  throw new Error(
    `Selected model ${modelId} does not support image inputs. Choose Auto or a vision-capable model to use chat image attachments.`,
  );
}

export async function streamAgentResponse({
  env,
  pageUrl,
  pageTitle,
  pageContent,
  messages,
  modelOverride,
  tools,
  automationEnabled,
  language = null,
  onChunk,
  onAssistant,
  signal,
}: {
  env: Record<string, string | undefined>;
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: unknown;
  modelOverride: string | null;
  tools: string[];
  automationEnabled: boolean;
  language?: string | null;
  onChunk: (text: string) => void;
  onAssistant: (assistant: AssistantMessage) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const normalizedMessages = normalizeMessages(messages);
  const hasImageInputs = hasImageContent(normalizedMessages);
  const toolList = resolveToolList(automationEnabled, tools, TOOL_DEFINITIONS);

  const systemPrompt = buildSystemPrompt({
    pageUrl,
    pageTitle,
    pageContent,
    automationEnabled,
    language,
  });

  const resolved = await resolveAgentModel({
    env,
    pageContent,
    modelOverride,
    hasImageInputs,
  });

  let emittedContent = false;

  const runResolvedModel = async (modelResolution: typeof resolved): Promise<AssistantMessage> => {
    if ("transport" in modelResolution && modelResolution.transport === "cli") {
      if (hasImageInputs) {
        throw new Error(
          "Chat image attachments require an API vision model; CLI agent transport does not support images yet.",
        );
      }
      const prompt = flattenAgentForCli({ systemPrompt, messages: normalizedMessages });
      const result = await import("../llm/cli.js").then(({ runCliModel }) =>
        runCliModel({
          provider: modelResolution.cliProvider,
          prompt,
          model: modelResolution.cliModel,
          allowTools: false,
          timeoutMs: 120_000,
          env,
          config: modelResolution.cliConfig,
        }),
      );
      const text = sanitizeChatAssistantText(result.text);
      if (text) onChunk(text);
      return { role: "assistant", content: text } as unknown as AssistantMessage;
    }

    const { provider, model, maxOutputTokens, apiKeys } = modelResolution;
    ensureImageCapableAgentModel({ model, provider, hasImageInputs });
    const apiKey = resolveApiKeyForModel({ provider, apiKeys });

    const run = async (modelForRun: typeof model): Promise<AssistantMessage> => {
      const outputSanitizer = createChatOutputStreamSanitizer();
      const stream = streamSimple(
        modelForRun,
        {
          systemPrompt,
          messages: normalizedMessages,
          tools: toolList,
        },
        {
          maxTokens: maxOutputTokens,
          apiKey,
          signal,
        },
      );

      let assistant: AssistantMessage | null = null;
      for await (const event of stream) {
        if (event.type === "text_delta") {
          emittedContent = true;
          const delta = outputSanitizer.push(event.delta);
          if (delta) onChunk(delta);
        } else if (event.type === "done") {
          assistant = event.message;
          break;
        } else if (event.type === "error") {
          throw normalizeAgentStreamError(event.error);
        }
      }

      if (!assistant) {
        assistant = await stream.result().catch((error: unknown) => {
          throw normalizeAgentStreamError(error);
        });
      }

      if (!assistant) {
        throw new Error("Agent stream ended without a result.");
      }

      return sanitizeChatAssistantMessage(assistant);
    };

    try {
      return await run(model);
    } catch (error) {
      if (
        !emittedContent &&
        isOpenAiResponsesModel(model) &&
        isUnsupportedResponsesApiError(error)
      ) {
        return await run(withOpenAiChatCompletionsModel(model));
      }
      throw error;
    }
  };

  let assistant: AssistantMessage;
  try {
    assistant = await runResolvedModel(resolved);
  } catch (error) {
    if (
      !emittedContent &&
      shouldRetryRequestWithAutoModel({ error, hasImageInputs, modelOverride })
    ) {
      const autoResolved = await resolveAgentModel({
        env,
        pageContent,
        modelOverride: "auto",
        hasImageInputs,
      });
      assistant = await runResolvedModel(autoResolved);
    } else {
      throw error;
    }
  }

  onAssistant(sanitizeChatAssistantMessage(assistant));
}

export async function completeAgentResponse({
  env,
  pageUrl,
  pageTitle,
  pageContent,
  messages,
  modelOverride,
  tools,
  automationEnabled,
  language = null,
}: {
  env: Record<string, string | undefined>;
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: unknown;
  modelOverride: string | null;
  tools: string[];
  automationEnabled: boolean;
  language?: string | null;
}): Promise<AssistantMessage> {
  const normalizedMessages = normalizeMessages(messages);
  const hasImageInputs = hasImageContent(normalizedMessages);
  const toolList = resolveToolList(automationEnabled, tools, TOOL_DEFINITIONS);

  const systemPrompt = buildSystemPrompt({
    pageUrl,
    pageTitle,
    pageContent,
    automationEnabled,
    language,
  });

  const resolved = await resolveAgentModel({
    env,
    pageContent,
    modelOverride,
    hasImageInputs,
  });

  const runResolvedModel = async (modelResolution: typeof resolved): Promise<AssistantMessage> => {
    if ("transport" in modelResolution && modelResolution.transport === "cli") {
      if (hasImageInputs) {
        throw new Error(
          "Chat image attachments require an API vision model; CLI agent transport does not support images yet.",
        );
      }
      const prompt = flattenAgentForCli({ systemPrompt, messages: normalizedMessages });
      const result = await import("../llm/cli.js").then(({ runCliModel }) =>
        runCliModel({
          provider: modelResolution.cliProvider,
          prompt,
          model: modelResolution.cliModel,
          allowTools: false,
          timeoutMs: 120_000,
          env,
          config: modelResolution.cliConfig,
        }),
      );
      return {
        role: "assistant",
        content: sanitizeChatAssistantText(result.text),
      } as unknown as AssistantMessage;
    }

    const { provider, model, maxOutputTokens, apiKeys } = modelResolution;
    ensureImageCapableAgentModel({ model, provider, hasImageInputs });
    const apiKey = resolveApiKeyForModel({ provider, apiKeys });

    const run = (modelForRun: typeof model) =>
      completeSimple(
        modelForRun,
        {
          systemPrompt,
          messages: normalizedMessages,
          tools: toolList,
        },
        {
          maxTokens: maxOutputTokens,
          apiKey,
        },
      );

    try {
      return sanitizeChatAssistantMessage(await run(model));
    } catch (error) {
      if (isOpenAiResponsesModel(model) && isUnsupportedResponsesApiError(error)) {
        return sanitizeChatAssistantMessage(await run(withOpenAiChatCompletionsModel(model)));
      }
      throw error;
    }
  };

  try {
    return await runResolvedModel(resolved);
  } catch (error) {
    if (shouldRetryRequestWithAutoModel({ error, hasImageInputs, modelOverride })) {
      const autoResolved = await resolveAgentModel({
        env,
        pageContent,
        modelOverride: "auto",
        hasImageInputs,
      });
      return await runResolvedModel(autoResolved);
    }
    throw error;
  }
}
