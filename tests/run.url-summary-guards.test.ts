import { describe, expect, it } from "vitest";
import { assertUrlSummaryQuality } from "../src/run/flows/url/summary-guards.js";

const longLength = { kind: "preset" as const, preset: "long" as const };

describe("url summary quality guards", () => {
  it("rejects slide markers when slides were not requested", () => {
    expect(() =>
      assertUrlSummaryQuality({
        markdown: "[slide:1]\nTranscript-like chunk",
        outputLanguage: { kind: "auto" },
        lengthArg: longLength,
        hasSlides: false,
      }),
    ).toThrow(/slide markers/i);
  });

  it("allows slide markers when slides were requested", () => {
    expect(() =>
      assertUrlSummaryQuality({
        markdown: "[slide:1]\n## Setup\nSummary.",
        outputLanguage: { kind: "auto" },
        lengthArg: longLength,
        hasSlides: true,
      }),
    ).not.toThrow();
  });

  it("rejects English-looking output for Chinese summaries", () => {
    expect(() =>
      assertUrlSummaryQuality({
        markdown:
          "This is an English transcript-like answer that keeps going in the source language instead of Chinese. ".repeat(
            6,
          ),
        outputLanguage: { kind: "fixed", tag: "zh-CN", label: "Chinese (Simplified)" },
        lengthArg: longLength,
        hasSlides: false,
      }),
    ).toThrow(/Chinese \(Simplified\)/);
  });

  it("rejects default summaries that massively exceed the requested length", () => {
    expect(() =>
      assertUrlSummaryQuality({
        markdown: "x".repeat(20_000),
        outputLanguage: { kind: "auto" },
        lengthArg: longLength,
        hasSlides: false,
      }),
    ).toThrow(/overlong summary/i);
  });

  it("does not enforce the default length guard for custom prompts", () => {
    expect(() =>
      assertUrlSummaryQuality({
        markdown: "x".repeat(20_000),
        outputLanguage: { kind: "auto" },
        lengthArg: longLength,
        hasSlides: false,
        promptOverride: "Translate the full transcript.",
      }),
    ).not.toThrow();
  });
});
