import type { ModelRequestOptions } from "../model-options.js";

export type OpenAiClientConfig = {
  apiKey: string;
  baseURL?: string;
  useChatCompletions: boolean;
  isOpenRouter: boolean;
  extraHeaders?: Record<string, string>;
  requestOptions?: ModelRequestOptions;
  /** Force the Responses API path regardless of model name (ChatGPT Codex OAuth). */
  forceResponses?: boolean;
  /**
   * OpenAI-compatible gateway that needs custom-fetch (to carry `extraHeaders`)
   * and per-model endpoint selection: `gpt-5*` models use `/responses`, all
   * others use `/chat/completions`. Used by GitHub Copilot subscription auth.
   */
  customGateway?: boolean;
};
