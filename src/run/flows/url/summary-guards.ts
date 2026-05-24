import type { OutputLanguage } from "../../../language.js";
import { SUMMARY_LENGTH_MAX_CHARACTERS } from "../../../prompts/index.js";
import type { UrlFlowContext } from "./types.js";

const SLIDE_MARKER_LINE_RE = /^\s{0,3}\[slide:\d+\]\s*$/im;
const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;
const ENGLISH_FOR_CHINESE_ERROR_RE =
  /returned English-looking output even though .+ was requested/i;

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function isChineseOutputLanguage(language: OutputLanguage): boolean {
  if (language.kind !== "fixed") return false;
  const tag = language.tag.toLowerCase();
  const label = language.label.toLowerCase();
  return tag === "zh" || tag.startsWith("zh-") || label.includes("chinese");
}

function formatOutputLanguageLabel(language: OutputLanguage): string {
  return language.kind === "fixed" ? language.label : "the requested language";
}

function looksLikeEnglishForChinese(markdown: string): boolean {
  const han = countMatches(markdown, HAN_RE);
  const latin = countMatches(markdown, LATIN_LETTER_RE);
  const signal = han + latin;
  if (signal < 80) return false;
  if (latin >= 120 && han < 20) return true;
  return latin >= 300 && han / signal < 0.03;
}

function resolveDefaultSummaryLengthLimit(
  lengthArg: UrlFlowContext["flags"]["lengthArg"],
): number | null {
  if (lengthArg.kind === "preset") {
    const max = SUMMARY_LENGTH_MAX_CHARACTERS[lengthArg.preset];
    return Math.max(max * 3, max + 3_000);
  }
  if (lengthArg.maxCharacters <= 0) return null;
  return Math.max(lengthArg.maxCharacters * 2, lengthArg.maxCharacters + 3_000);
}

export function assertUrlSummaryQuality({
  markdown,
  outputLanguage,
  lengthArg,
  hasSlides,
  promptOverride,
  sourceLabel = "LLM",
}: {
  markdown: string;
  outputLanguage: OutputLanguage;
  lengthArg: UrlFlowContext["flags"]["lengthArg"];
  hasSlides: boolean;
  promptOverride?: string | null;
  sourceLabel?: string;
}): void {
  const trimmed = markdown.trim();
  if (!trimmed) return;

  if (!hasSlides && SLIDE_MARKER_LINE_RE.test(trimmed)) {
    throw new Error(`${sourceLabel} returned slide markers even though slides were not requested`);
  }

  if (isChineseOutputLanguage(outputLanguage) && looksLikeEnglishForChinese(trimmed)) {
    throw new Error(
      `${sourceLabel} returned English-looking output even though ${formatOutputLanguageLabel(outputLanguage)} was requested`,
    );
  }

  if (!promptOverride) {
    const limit = resolveDefaultSummaryLengthLimit(lengthArg);
    if (limit != null && trimmed.length > limit) {
      throw new Error(
        `${sourceLabel} returned an overlong summary (${formatCount(trimmed.length)} characters; guard limit ${formatCount(limit)})`,
      );
    }
  }
}

export function isUrlSummaryLanguageMismatchError(error: unknown): boolean {
  return error instanceof Error && ENGLISH_FOR_CHINESE_ERROR_RE.test(error.message);
}
