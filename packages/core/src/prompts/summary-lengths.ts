import type { SummaryLength } from "../shared/contracts.js";

export type SummaryLengthSpec = {
  guidance: string;
  formatting: string;
  targetCharacters: number;
  minCharacters: number;
  maxCharacters: number;
  maxTokens: number;
};

export const SUMMARY_LENGTH_SPECS: Record<SummaryLength, SummaryLengthSpec> = {
  short: {
    guidance:
      "Write a tight summary that delivers the primary claim plus one high-signal supporting detail.",
    formatting:
      "Use 1-2 short paragraphs (a single paragraph is fine). Aim for 2-5 sentences total.",
    targetCharacters: 900,
    minCharacters: 600,
    maxCharacters: 1200,
    maxTokens: 768,
  },
  medium: {
    guidance:
      "Write a clear summary that covers the core claim plus the most important supporting evidence or data points.",
    formatting:
      'Use structured Markdown: start with a "## " heading, then use 2-4 concise bullets or short paragraphs under 1-2 sections. Avoid a single wall-of-text paragraph.',
    targetCharacters: 1800,
    minCharacters: 1200,
    maxCharacters: 2500,
    maxTokens: 1536,
  },
  long: {
    guidance:
      "Write a detailed summary that prioritizes the most important points first, followed by key supporting facts or events, then secondary details or conclusions stated in the source.",
    formatting:
      'Use structured Markdown with multiple "## " sections and concise bullet lists for grouped evidence, steps, or tradeoffs. Use "### " subsections when useful; keep paragraphs to 1-3 sentences.',
    targetCharacters: 4200,
    minCharacters: 2500,
    maxCharacters: 6000,
    maxTokens: 3072,
  },
  xl: {
    guidance:
      "Write a detailed summary that captures the main points, supporting facts, and concrete numbers or quotes when present.",
    formatting:
      'Use multiple "## " Markdown sections and "### " subsections when useful. Prefer bullets for grouped evidence, steps, comparisons, and examples; keep paragraphs to 1-3 sentences.',
    targetCharacters: 9000,
    minCharacters: 6000,
    maxCharacters: 14000,
    maxTokens: 6144,
  },
  xxl: {
    guidance:
      "Write a comprehensive summary that covers background, main points, evidence, and stated outcomes in the source text; avoid adding implications or recommendations unless explicitly stated.",
    formatting:
      'Use multiple "## " Markdown sections and "### " subsections for nested topics. Prefer bullets for grouped evidence, steps, comparisons, and examples; keep paragraphs to 1-3 sentences.',
    targetCharacters: 17000,
    minCharacters: 14000,
    maxCharacters: 22000,
    maxTokens: 12288,
  },
};

const formatCount = (value: number): string => value.toLocaleString();

export const SUMMARY_LENGTH_TO_TOKENS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.maxTokens]),
) as Record<SummaryLength, number>;

export const SUMMARY_LENGTH_TARGET_CHARACTERS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.targetCharacters]),
) as Record<SummaryLength, number>;

export const SUMMARY_LENGTH_MAX_CHARACTERS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.maxCharacters]),
) as Record<SummaryLength, number>;

export function resolveSummaryLengthSpec(length: SummaryLength): SummaryLengthSpec {
  // SummaryLength is a contracts-enforced enum in all call sites; suppress generic injection warning.
  // eslint-disable-next-line security/detect-object-injection
  return SUMMARY_LENGTH_SPECS[length];
}

export function formatPresetLengthGuidance(length: SummaryLength): string {
  const spec = resolveSummaryLengthSpec(length);
  return `Target length: around ${formatCount(spec.targetCharacters)} characters (acceptable range ${formatCount(spec.minCharacters)}-${formatCount(spec.maxCharacters)}). This is a soft guideline; prioritize clarity.`;
}
