const FINAL_ANSWER_TAG_PATTERN = /<\/?\s*final[_-]?answer\s*>/gi;
const CLASSIFICATION_LABELS = [
  "系统/架构设计",
  "算法/研究论文",
  "工程实践/经验总结",
  "概念综述/行业分析",
] as const;
const CLASSIFICATION_LINE_PATTERN = new RegExp(
  `^(?:${CLASSIFICATION_LABELS.map((label) => escapeRegExp(label)).join("|")})\\s*[：:]\\s*(?:是|否|yes|no|true|false)\\s*$`,
  "i",
);
const CLASSIFICATION_LABEL_PATTERN = new RegExp(
  `^(?:${CLASSIFICATION_LABELS.map((label) => escapeRegExp(label)).join("|")})$`,
  "i",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isFenceDelimiter(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

function normalizeSummaryLine(line: string): string {
  return line
    .trim()
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

export function isClassificationOnlySummary(markdown: string): boolean {
  const lines = markdown
    .split(/\r?\n/)
    .map(normalizeSummaryLine)
    .filter((line) => line.length > 0 && !/^-{3,}$/.test(line));

  if (lines.length === 0) return false;
  if (lines.length === 1) return CLASSIFICATION_LABEL_PATTERN.test(lines[0]);

  const classificationLines = lines.filter((line) => CLASSIFICATION_LINE_PATTERN.test(line));
  return classificationLines.length >= 2 && classificationLines.length === lines.length;
}

export function assertUsableSummaryMarkdown(markdown: string, sourceLabel = "LLM"): void {
  if (isClassificationOnlySummary(markdown)) {
    throw new Error(`${sourceLabel} returned classification labels instead of a summary`);
  }
}

export function sanitizeSummaryMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
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

    const cleaned = line.replace(FINAL_ANSWER_TAG_PATTERN, "");
    if (cleaned === line) {
      output.push(line);
      continue;
    }
    output.push(cleaned.trim().length === 0 ? "" : cleaned.replace(/[ \t]{2,}/g, " ").trimEnd());
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
