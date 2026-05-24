import { parseLengthArg } from "../flags.js";
import { SUMMARY_LENGTH_TARGET_CHARACTERS } from "../prompts/index.js";
import type { ContextSourceMeta } from "../shared/sse-events.js";

export function resolveLengthTargetCharacters(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = parseLengthArg(raw);
    return parsed.kind === "chars"
      ? parsed.maxCharacters
      : (SUMMARY_LENGTH_TARGET_CHARACTERS[parsed.preset] ?? null);
  } catch {
    return null;
  }
}

export function summarizeSourceMetaForLog(meta: ContextSourceMeta | null) {
  return {
    sourceMetaPresent: Boolean(meta),
    sourceMetaInputSource: meta?.input?.source ?? null,
    sourceMetaRequestedMode: meta?.input?.requestedMode ?? null,
    sourceMetaContentStrategy: meta?.content?.strategy ?? null,
    sourceMetaTranscriptSource: meta?.transcript?.source ?? null,
    sourceMetaMediaKind: meta?.media?.kind ?? null,
  };
}
