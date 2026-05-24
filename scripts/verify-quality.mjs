#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const model = process.env.SUMMARIZE_QUALITY_MODEL || "auto";
const length = process.env.SUMMARIZE_QUALITY_LENGTH || "short";
const timeout = process.env.SUMMARIZE_QUALITY_TIMEOUT || "2m";

const paragraphs = [
  "Quarterly Field Notes describes a product team that reduced repeated customer escalations by changing its release review process. The main lesson is that a small verification checklist caught more issues than a larger status meeting, because the checklist forced engineers to exercise the real user path before shipping.",
  "The team previously relied on unit tests, mocked browser tests, and optimistic code review. Those checks were useful, but they did not prove that settings persisted from older versions, daemon streams carried all metadata, or the installed browser extension had actually reloaded the current build.",
  "A narrow incident showed the gap. A source provenance panel was present in the UI and the extractor produced metadata, yet the daemon dropped the metadata while forwarding stream events. Another incident showed that an old stored length setting made a short page look like a full rewrite instead of a compact summary.",
  "The corrective action was to define feature-specific gates. UI changes need a DOM probe. Streamed metadata needs a daemon-to-panel test. Default settings need migration coverage for existing storage. Prompt changes need deterministic prompt assertions plus a live quality smoke for obvious overlong rewrites.",
  "One nonessential example used only for rewrite detection is MARKER-ALPHA-731. Another low-value example is MARKER-BETA-842. A third detail that should not survive a compact summary is MARKER-GAMMA-953. These markers are intentionally repetitive and should be omitted unless the output is copying the source paragraph by paragraph.",
  "The desired outcome is practical rather than ceremonial. The team wants fewer manual bug reports from users, faster root-cause isolation when a regression appears, and clear evidence that a fix works in the same path users actually exercise.",
];
const source = paragraphs.join("\n\n");

const tempDir = mkdtempSync(join(tmpdir(), "summarize-quality-"));
const inputPath = join(tempDir, "quality-smoke.txt");
writeFileSync(inputPath, source, "utf8");

try {
  const args = [
    "-s",
    "summarize",
    "--",
    "--json",
    "--metrics",
    "off",
    "--no-cache",
    "--force-summary",
    "--length",
    length,
    "--language",
    "en",
    "--timeout",
    timeout,
    "--max-output-tokens",
    "1k",
    "--model",
    model,
    inputPath,
  ];
  const result = spawnSync("pnpm", args, {
    cwd: join(new URL("..", import.meta.url).pathname),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `pnpm exited ${result.status}`);
  }

  const payload = JSON.parse(result.stdout);
  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  if (!summary) throw new Error("quality smoke returned an empty summary");

  const sourceChars = source.length;
  const summaryChars = summary.length;
  const sourceSentences = source
    .split(/[.!?]\s+/)
    .filter((sentence) => sentence.trim().length > 24);
  const summarySentences = summary
    .split(/[.!?]\s+/)
    .filter((sentence) => sentence.trim().length > 24);
  const markers = summary.match(/MARKER-[A-Z0-9-]+/g) ?? [];

  const failures = [];
  if (summaryChars > 1600) failures.push(`summary too long (${summaryChars} chars > 1600)`);
  if (summaryChars > sourceChars * 0.62) {
    failures.push(`summary not compressed enough (${summaryChars}/${sourceChars} chars)`);
  }
  if (summarySentences.length > Math.ceil(sourceSentences.length * 0.65)) {
    failures.push(
      `too many output sentences (${summarySentences.length}/${sourceSentences.length})`,
    );
  }
  if (markers.length > 1) failures.push(`copied diagnostic markers (${markers.join(", ")})`);

  if (failures.length > 0) {
    throw new Error(`quality smoke failed: ${failures.join("; ")}\n\n${summary}`);
  }

  console.log(
    `quality smoke ok: ${summaryChars}/${sourceChars} chars, ${summarySentences.length}/${sourceSentences.length} sentences, model=${model}`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
