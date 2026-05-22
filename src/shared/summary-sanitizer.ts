const FINAL_ANSWER_TAG_PATTERN = /<\/?\s*final[_-]?answer\s*>/gi;

function isFenceDelimiter(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
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
