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
};
