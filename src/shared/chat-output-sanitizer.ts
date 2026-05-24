export const CHAT_UNUSABLE_ASSISTANT_MESSAGE =
  "The model returned an internal reference instead of a usable answer. Please retry.";

const FINAL_ANSWER_TAG_PATTERN =
  /(?:<\s*\/?\s*final[_-]?answer(?:\s+[^>]*)?\s*>|<\/?\s*final[_-]?answer\s*>?|final[_-]?answer\s*>)/gi;
const PARTIAL_FINAL_ANSWER_TAG_PATTERN = /<\s*\/?\s*final[_-]?answer[^>\r\n]*$/gi;
const FILE_REFERENCE_PATTERN =
  /^(?:`|"|'|\[|\(|<)*\s*(?:file:\/\/)?(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])(?:[^<>|]*[\\/])?[^<>|\r\n]*\.(?:md|markdown|txt|tsx?|jsx?|mjs|cjs|json|ya?ml|py|sh|rs|go|java|kt|swift|c|cc|cpp|h|hpp|html?|css|scss|xml|sql)(?::\d+(?:-\d+)?)?(?:`|"|'|\]|\)|>)*\s*$/i;
const SOURCE_LABEL_PATTERN = /^(?:source|reference|file|path)\s*[：:]\s*/i;

function isFenceDelimiter(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

function stripProtocolTags(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (isFenceDelimiter(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    output.push(
      line
        .replace(FINAL_ANSWER_TAG_PATTERN, "")
        .replace(PARTIAL_FINAL_ANSWER_TAG_PATTERN, "")
        .replace(/[ \t]{2,}/g, " "),
    );
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeReferenceLine(line: string): string {
  return line
    .trim()
    .replace(/^\s{0,3}(?:>+\s*)?(?:[-*+]\s+|\d+[.)]\s+)?/, "")
    .replace(SOURCE_LABEL_PATTERN, "")
    .trim();
}

export function isPathOnlyChatReference(markdown: string): boolean {
  const lines = stripProtocolTags(markdown)
    .split(/\r?\n/)
    .map(normalizeReferenceLine)
    .filter(Boolean);

  return (
    lines.length > 0 &&
    lines.length <= 3 &&
    lines.every((line) => FILE_REFERENCE_PATTERN.test(line))
  );
}

export function sanitizeChatAssistantText(
  markdown: string,
  opts: { final?: boolean } = {},
): string {
  const cleaned = stripProtocolTags(markdown);
  if (!cleaned.trim()) return "";
  if (isPathOnlyChatReference(cleaned)) {
    return opts.final === false ? "" : CHAT_UNUSABLE_ASSISTANT_MESSAGE;
  }
  return cleaned;
}

export function sanitizeChatAssistantContent<T>(content: T, opts?: { final?: boolean }): T {
  if (typeof content === "string") {
    return sanitizeChatAssistantText(content, opts) as T;
  }
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (!part || typeof part !== "object") return part;
    const record = part as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") return part;
    return { ...record, text: sanitizeChatAssistantText(record.text, opts) };
  }) as T;
}

export function sanitizeChatAssistantMessage<T extends { role?: unknown; content?: unknown }>(
  message: T,
  opts?: { final?: boolean },
): T {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: sanitizeChatAssistantContent(message.content, opts),
  };
}

export function createChatOutputStreamSanitizer() {
  let rawText = "";
  let emittedText = "";

  return {
    push(delta: string): string {
      rawText += delta;
      const nextText = sanitizeChatAssistantText(rawText, { final: false });
      if (!nextText.startsWith(emittedText)) {
        emittedText = nextText;
        return "";
      }
      const nextDelta = nextText.slice(emittedText.length);
      emittedText = nextText;
      return nextDelta;
    },
  };
}
