import { isClassificationOnlySummary, sanitizeSummaryMarkdown } from "../../lib/runtime-contracts";
import { selectMarkdownForLayout } from "./slides-state";
import { buildSummaryEmptyState } from "./summary-empty-state";
import type { SummaryProgress } from "./summary-progress";
import { linkifyTimestamps } from "./timestamp-links";
import type { PanelPhase } from "./types";

type MermaidRuntime = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

const MERMAID_MAX_CHARS = 50_000;
const MERMAID_START_PATTERN =
  /\b((?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|requirementDiagram)\b/i;
const FLOWCHART_HEADER_PATTERN = /^((?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR))\s+(.+)$/i;
const FLOWCHART_EDGE_PATTERN =
  /([A-Za-z_][\w-]*(?:\[[^\]]+\])?\s*(?:-->|---|-.->|==>|--|==)\s*[A-Za-z_][\w-]*(?:\[[^\]]+\])?)/g;
const FLOWCHART_EDGE_START_PATTERN = /^[A-Za-z_][\w-]*(?:\[[^\]]+\])?\s*(?:-->|---|-.->|==>|--|==)/;
const MERMAID_DIRECTIVE_PREFIX_PATTERN = /^\s*(%%\{.*?\}%%)\s*/;
const TEXT_DIAGRAM_LANGUAGE = "summary-chart";
const BOX_DRAWING_PATTERN = /[\u2500-\u257f]/u;
const MARKDOWN_TABLE_SEPARATOR_PATTERN = /^\s{0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const defaultMermaidLoader = () =>
  import("mermaid").then((module) => module.default as MermaidRuntime);
let mermaidLoadPromise: Promise<MermaidRuntime> | null = null;
let mermaidRuntimeLoader: () => Promise<MermaidRuntime> = defaultMermaidLoader;
let mermaidCounter = 0;

export function setMermaidRuntimeLoaderForTest(loader: (() => Promise<MermaidRuntime>) | null) {
  mermaidLoadPromise = null;
  mermaidRuntimeLoader = loader ?? defaultMermaidLoader;
}

function loadMermaid(): Promise<MermaidRuntime> {
  mermaidLoadPromise ??= mermaidRuntimeLoader().then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
      ],
      maxTextSize: MERMAID_MAX_CHARS,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: {
        background: "#ffffff",
        primaryColor: "#eef2ff",
        primaryBorderColor: "#4f46e5",
        primaryTextColor: "#111827",
        secondaryColor: "#ecfeff",
        secondaryBorderColor: "#0891b2",
        secondaryTextColor: "#111827",
        tertiaryColor: "#f8fafc",
        tertiaryBorderColor: "#64748b",
        tertiaryTextColor: "#111827",
        lineColor: "#475569",
        textColor: "#111827",
        mainBkg: "#f8fafc",
        nodeBorder: "#64748b",
        clusterBkg: "#f8fafc",
        clusterBorder: "#94a3b8",
        titleColor: "#111827",
        edgeLabelBackground: "#ffffff",
      },
      htmlLabels: false,
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
      },
    });
    return mermaid;
  });
  return mermaidLoadPromise;
}

function isMermaidCodeBlock(code: Element): boolean {
  const dataLanguage = code.getAttribute("data-language")?.trim().toLowerCase();
  if (dataLanguage === "mermaid") return true;

  for (const className of Array.from(code.classList)) {
    const normalized = className.toLowerCase().replace(/[{}]/g, "");
    if (normalized === "mermaid") return true;
    if (normalized === "language-mermaid" || normalized === "lang-mermaid") return true;
  }
  if (MERMAID_START_PATTERN.test(code.textContent?.trim() ?? "")) return true;
  return false;
}

function isFenceDelimiter(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
}

function countPipes(line: string): number {
  return line.match(/\|/g)?.length ?? 0;
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return MARKDOWN_TABLE_SEPARATOR_PATTERN.test(line);
}

function isWithinMarkdownTable(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!line.includes("|") || !line.trim()) return false;

  for (let probe = index; probe >= 0; probe -= 1) {
    const candidate = lines[probe] ?? "";
    if (!candidate.trim() || !candidate.includes("|")) break;
    if (isMarkdownTableSeparatorLine(candidate)) return true;
  }
  for (let probe = index + 1; probe < lines.length; probe += 1) {
    const candidate = lines[probe] ?? "";
    if (!candidate.trim() || !candidate.includes("|")) break;
    if (isMarkdownTableSeparatorLine(candidate)) return true;
  }
  return false;
}

function looksLikeTextDiagramLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.test(line)) return false;
  if (BOX_DRAWING_PATTERN.test(trimmed)) return true;

  const pipeCount = countPipes(trimmed);
  if (pipeCount >= 3) return true;
  return pipeCount >= 2 && /(?:\s\|\s|\|\|)/.test(trimmed);
}

function shouldFenceTextDiagramBlock(lines: string[]): boolean {
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  return (
    nonEmptyLines.some((line) => BOX_DRAWING_PATTERN.test(line)) ||
    nonEmptyLines.filter(looksLikeTextDiagramLine).length >= 2
  );
}

function collectTextDiagramBlock(
  lines: string[],
  startIndex: number,
): { lines: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      let probe = index + 1;
      while (probe < lines.length && !(lines[probe] ?? "").trim()) probe += 1;
      if (
        probe < lines.length &&
        !isWithinMarkdownTable(lines, probe) &&
        looksLikeTextDiagramLine(lines[probe] ?? "")
      ) {
        block.push(line);
        index += 1;
        continue;
      }
      break;
    }
    if (isWithinMarkdownTable(lines, index) || !looksLikeTextDiagramLine(line)) break;
    block.push(line);
    index += 1;
  }

  return { lines: block, nextIndex: index };
}

function fenceTextDiagramBlock(lines: string[]): string[] {
  const source = lines.join("\n");
  const delimiter = source.includes("```") ? "~~~" : "```";
  return [`${delimiter}${TEXT_DIAGRAM_LANGUAGE}`, ...lines, delimiter];
}

export function normalizeTextDiagramBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isFenceDelimiter(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence || isWithinMarkdownTable(lines, index) || !looksLikeTextDiagramLine(line)) {
      output.push(line);
      continue;
    }

    const block = collectTextDiagramBlock(lines, index);
    if (shouldFenceTextDiagramBlock(block.lines)) {
      output.push(...fenceTextDiagramBlock(block.lines));
      index = block.nextIndex - 1;
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function startsNewMarkdownBlock(line: string): boolean {
  return /^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>)/.test(line);
}

function prefixLooksLikeMermaidLabel(prefix: string): boolean {
  const trimmed = prefix.trim();
  return (
    trimmed.length === 0 ||
    /(?:mermaid|架构图|流程图|时序图|关系图|diagram|flowchart|chart)\s*[:：]?\s*$/i.test(trimmed)
  );
}

function looksLikeMermaidContinuation(line: string): boolean {
  const trimmed = line.trim();
  return (
    FLOWCHART_EDGE_START_PATTERN.test(trimmed) ||
    /^[A-Za-z_][\w-]*\[/.test(trimmed) ||
    /(?:-->|---|-.->|==>)/.test(trimmed)
  );
}

function consumeMermaidDirectivePrefix(line: string): { directives: string[]; rest: string } {
  const directives: string[] = [];
  let rest = line;
  while (true) {
    const match = rest.match(MERMAID_DIRECTIVE_PREFIX_PATTERN);
    if (!match?.[1]) break;
    directives.push(match[1].trim());
    rest = rest.slice(match[0].length);
  }
  return { directives, rest };
}

function normalizeFlowchartSource(source: string): string {
  const compact = source.replace(/\s+/g, " ").trim();
  const header = compact.match(FLOWCHART_HEADER_PATTERN);
  if (!header) return compact.replace(/\s*;\s*/g, "\n");

  const directive = header[1] ?? "";
  const body = header[2]?.trim() ?? "";
  const statements = Array.from(body.matchAll(FLOWCHART_EDGE_PATTERN), (match) => match[0].trim());
  const leftover = statements
    .reduce((remaining, statement) => remaining.replace(statement, " "), body)
    .replace(/[;\s]+/g, "");

  if (statements.length > 0 && leftover.length === 0) {
    return [directive, ...statements].join("\n");
  }

  const bodyWithBreaks = body
    .replace(/\s*;\s*/g, "\n")
    .replace(/\s+(?=[A-Za-z_][\w-]*(?:\[[^\]]+\])?\s*(?:-->|---|-.->|==>|--|==))/g, "\n");
  return [directive, bodyWithBreaks.trim()].filter(Boolean).join("\n");
}

function normalizeMermaidSource(source: string): string {
  const trimmed = source.trim();
  const lines = trimmed.split(/\r?\n/);
  const directives: string[] = [];
  while (lines.length > 0) {
    const parsed = consumeMermaidDirectivePrefix(lines[0] ?? "");
    if (parsed.directives.length === 0 || parsed.rest.trim()) break;
    directives.push(...parsed.directives);
    lines.shift();
  }
  const body = lines.join("\n").trim();
  const normalizedBody = /^(?:flowchart|graph)\s+/i.test(body)
    ? normalizeFlowchartSource(body)
    : body.replace(/\s*;\s*/g, "\n");
  return [...directives, normalizedBody].filter(Boolean).join("\n");
}

export function normalizeInlineMermaidBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isFenceDelimiter(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }

    const directivePrefix = consumeMermaidDirectivePrefix(line);
    const directives = [...directivePrefix.directives];
    let candidateLine = directives.length > 0 ? directivePrefix.rest : line;
    let candidateIndex = index;
    while (!candidateLine.trim() && candidateIndex + 1 < lines.length) {
      const next = lines[candidateIndex + 1] ?? "";
      candidateIndex += 1;
      if (!next.trim()) continue;
      const parsedNext = consumeMermaidDirectivePrefix(next);
      directives.push(...parsedNext.directives);
      candidateLine = parsedNext.rest;
      break;
    }

    const match = candidateLine.match(MERMAID_START_PATTERN);
    const startIndex = match?.index ?? -1;
    const prefix = startIndex >= 0 ? candidateLine.slice(0, startIndex).trimEnd() : "";
    if (startIndex < 0 || !prefixLooksLikeMermaidLabel(prefix)) {
      output.push(line);
      continue;
    }

    index = candidateIndex;
    const chunks = [...directives, candidateLine.slice(startIndex).trim()];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (!next.trim() || isFenceDelimiter(next) || startsNewMarkdownBlock(next)) break;
      if (!looksLikeMermaidContinuation(next)) break;
      chunks.push(next.trim());
      index += 1;
    }

    const source = normalizeMermaidSource(chunks.join("\n"));
    if (prefix) {
      output.push(prefix, "", "```mermaid", source, "```");
    } else {
      output.push("```mermaid", source, "```");
    }
  }

  return output.join("\n");
}

function sanitizeMermaidSvg(container: HTMLElement) {
  container.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => {
    node.remove();
  });
  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "xlink:href" || name === "src") &&
        (value.startsWith("javascript:") ||
          value.startsWith("vbscript:") ||
          value.startsWith("data:text/html"))
      ) {
        element.removeAttribute(attr.name);
      }
    }
  }
}

function parseSvgViewBoxWidth(viewBox: string | null): number | null {
  if (!viewBox) return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 4) return null;
  const width = parts[2];
  return Number.isFinite(width) && width > 0 ? width : null;
}

function prepareMermaidSvgLayout(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>("svg");
  if (!svg) return;

  svg.style.maxWidth = "none";
  svg.style.height = "auto";

  const viewBoxWidth = parseSvgViewBoxWidth(svg.getAttribute("viewBox"));
  if (viewBoxWidth != null) {
    svg.style.width = `${Math.ceil(viewBoxWidth)}px`;
  }
}

function createMermaidFullscreenButton(viewport: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost icon renderMermaid__fullscreen";
  button.setAttribute("aria-label", "全屏查看 Mermaid 图");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM4 15h2v3h3v2H4v-5Zm14 0h2v5h-5v-2h3v-3Z" />
    </svg>
  `;
  button.addEventListener("click", () => {
    openMermaidFullscreen(viewport);
  });
  return button;
}

function closeFullscreenModal(modal: HTMLElement, previousFocus: Element | null) {
  const shouldExitFullscreen = document.fullscreenElement === modal;
  if (shouldExitFullscreen) {
    void document.exitFullscreen().catch(() => {});
  }
  modal.remove();
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
    previousFocus.focus();
  }
}

function openMermaidFullscreen(sourceViewport: HTMLElement) {
  const sourceSvg = sourceViewport.querySelector<SVGSVGElement>("svg");
  if (!sourceSvg) return;

  document.querySelector(".renderMermaidModal")?.remove();

  const previousFocus = document.activeElement;
  const modal = document.createElement("div");
  modal.className = "renderMermaidModal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Mermaid 图全屏查看");

  const panel = document.createElement("div");
  panel.className = "renderMermaidModal__panel";

  const toolbar = document.createElement("div");
  toolbar.className = "renderMermaidModal__toolbar";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ghost icon renderMermaidModal__close";
  closeButton.setAttribute("aria-label", "关闭 Mermaid 图全屏查看");
  closeButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm11.2 0L19 6.4 6.4 19 5 17.6 17.6 5Z" />
    </svg>
  `;

  const canvas = document.createElement("div");
  canvas.className = "renderMermaidModal__canvas";
  canvas.append(sourceSvg.cloneNode(true));
  prepareMermaidSvgLayout(canvas);

  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    closeFullscreenModal(modal, previousFocus);
  };
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  closeButton.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", onKeyDown);

  toolbar.append(closeButton);
  panel.append(toolbar, canvas);
  modal.append(panel);
  document.body.append(modal);
  closeButton.focus();
  const fullscreenRequest = modal.requestFullscreen?.();
  void fullscreenRequest?.catch(() => {});
}

export async function renderMermaidPreviews(markdownHost: HTMLElement) {
  const blocks = Array.from(markdownHost.querySelectorAll("pre > code")).filter(isMermaidCodeBlock);
  if (blocks.length === 0) return;

  let mermaid: MermaidRuntime;
  try {
    mermaid = await loadMermaid();
  } catch {
    return;
  }

  for (const code of blocks) {
    const pre = code.parentElement;
    const source = normalizeMermaidSource(code.textContent?.trim() ?? "");
    if (
      !pre ||
      !markdownHost.contains(pre) ||
      source.length === 0 ||
      source.length > MERMAID_MAX_CHARS
    ) {
      continue;
    }

    try {
      const id = `summary-mermaid-${Date.now()}-${++mermaidCounter}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);
      if (!pre.isConnected || !markdownHost.contains(pre)) continue;

      const figure = document.createElement("figure");
      figure.className = "renderMermaid";
      const viewport = document.createElement("div");
      viewport.className = "renderMermaid__viewport";
      viewport.innerHTML = svg;
      sanitizeMermaidSvg(viewport);
      prepareMermaidSvgLayout(viewport);
      bindFunctions?.(viewport);
      const actions = document.createElement("div");
      actions.className = "renderMermaid__actions";
      actions.append(createMermaidFullscreenButton(viewport));
      figure.append(actions, viewport);
      pre.replaceWith(figure);
      figure.closest(".chatMessage")?.classList.add("chatMessage--wide");
    } catch {
      pre.classList.add("renderMermaid__fallback");
    }
  }
}

function isTextDiagramCodeBlock(code: Element): boolean {
  const dataLanguage = code.getAttribute("data-language")?.trim().toLowerCase();
  if (dataLanguage === TEXT_DIAGRAM_LANGUAGE) return true;

  for (const className of Array.from(code.classList)) {
    const normalized = className.toLowerCase().replace(/[{}]/g, "");
    if (normalized === TEXT_DIAGRAM_LANGUAGE) return true;
    if (normalized === `language-${TEXT_DIAGRAM_LANGUAGE}`) return true;
    if (normalized === `lang-${TEXT_DIAGRAM_LANGUAGE}`) return true;
  }

  const lines = (code.textContent ?? "").split(/\r?\n/);
  return shouldFenceTextDiagramBlock(lines);
}

function decorateTextDiagramBlocks(markdownHost: HTMLElement) {
  for (const code of Array.from(markdownHost.querySelectorAll("pre > code"))) {
    if (!isTextDiagramCodeBlock(code)) continue;
    const pre = code.parentElement;
    if (!pre) continue;
    pre.classList.add("renderAsciiChart");
    pre.closest(".chatMessage")?.classList.add("chatMessage--wide");
  }
}

function wrapMarkdownTables(markdownHost: HTMLElement) {
  for (const table of Array.from(markdownHost.querySelectorAll("table"))) {
    if (table.parentElement?.classList.contains("renderTableScroll")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "renderTableScroll";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "表格");
    table.before(wrapper);
    wrapper.append(table);
    wrapper.closest(".chatMessage")?.classList.add("chatMessage--wide");
  }
}

export function enhanceRenderedSummaryBlocks(markdownHost: HTMLElement) {
  wrapMarkdownTables(markdownHost);
  decorateTextDiagramBlocks(markdownHost);
}

function createCopyButton({
  text,
  headerSetStatus,
}: {
  text: string;
  headerSetStatus: (text: string) => void;
}) {
  const button = document.createElement("button");
  button.className = "ghost icon render__copy";
  button.type = "button";
  button.setAttribute("aria-label", "复制摘要");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V6Zm-4 4a2 2 0 0 1 2-2h1v2H6v8h8v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z" />
    </svg>
  `;
  button.addEventListener("click", () => {
    void copySummaryText({ text, headerSetStatus });
  });
  return button;
}

async function copySummaryText({
  text,
  headerSetStatus,
}: {
  text: string;
  headerSetStatus: (text: string) => void;
}) {
  const trimmed = text.trim();
  if (!trimmed) {
    headerSetStatus("没有可复制的内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(trimmed);
    headerSetStatus("已复制");
    return;
  } catch {
    // fallback
  }
  const selection = document.getSelection();
  const range = document.createRange();
  const ghost = document.createElement("textarea");
  ghost.value = trimmed;
  ghost.setAttribute("readonly", "true");
  ghost.style.position = "fixed";
  ghost.style.opacity = "0";
  document.body.append(ghost);
  ghost.focus();
  ghost.select();
  const ok = document.execCommand("copy");
  ghost.remove();
  selection?.removeAllRanges();
  range.detach();
  headerSetStatus(ok ? "已复制" : "复制失败");
}

export function renderSummaryEmptyState({
  hostEl,
  state,
}: {
  hostEl: HTMLElement;
  state: ReturnType<typeof buildSummaryEmptyState>;
}) {
  if (!state) {
    hostEl.innerHTML = "";
    return;
  }
  const wrapper = document.createElement("section");
  wrapper.className = "renderEmpty";
  wrapper.dataset.emptyState = "true";
  const label = document.createElement("div");
  label.className = "renderEmpty__label";
  label.textContent = state.label;
  const message = document.createElement("p");
  message.className = "renderEmpty__message";
  message.textContent = state.message;
  wrapper.append(label, message);
  if (state.detail) {
    const detail = document.createElement("p");
    detail.className = "renderEmpty__detail";
    detail.textContent = state.detail;
    wrapper.append(detail);
  }
  if (state.progressActive) {
    const progress = document.createElement("div");
    progress.className = "renderEmpty__progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "摘要进度");
    const progressFill = document.createElement("div");
    progressFill.className = "renderEmpty__progressFill";
    if (state.progressPercent == null) {
      progress.dataset.indeterminate = "true";
    } else {
      const percent = `${state.progressPercent}%`;
      progress.style.setProperty("--empty-progress", percent);
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(state.progressPercent));
      const percentLabel = document.createElement("span");
      percentLabel.className = "renderEmpty__progressText";
      percentLabel.textContent = percent;
      progress.append(percentLabel);
    }
    progress.prepend(progressFill);
    wrapper.append(progress);
  }
  hostEl.replaceChildren(wrapper);
}

export function renderSummaryMarkdownDisplay({
  activeTabUrl,
  autoSummarize,
  currentSourceTitle,
  currentSourceUrl,
  hasSlides,
  headerSetStatus,
  hostEl,
  inputMode,
  markdown,
  md,
  phase,
  progress,
  renderInlineSlides,
  slidesEnabled,
  slidesLayout,
  tabTitle,
  tabUrl,
}: {
  activeTabUrl: string | null;
  autoSummarize: boolean;
  currentSourceTitle: string | null;
  currentSourceUrl: string | null;
  hasSlides: boolean;
  headerSetStatus: (text: string) => void;
  hostEl: HTMLElement;
  inputMode: "page" | "video";
  markdown: string;
  md: { render: (value: string) => string };
  phase: PanelPhase;
  progress: SummaryProgress | null;
  renderInlineSlides: (container: HTMLElement, opts?: { fallback?: boolean }) => void;
  slidesEnabled: boolean;
  slidesLayout: string;
  tabTitle: string | null;
  tabUrl: string | null;
}) {
  const displayMarkdown = sanitizeSummaryMarkdown(
    selectMarkdownForLayout({
      markdown,
      slidesEnabled,
      inputMode,
      hasSlides,
      slidesLayout,
    }),
  );
  if (!displayMarkdown.trim() || isClassificationOnlySummary(displayMarkdown)) {
    renderSummaryEmptyState({
      hostEl,
      state: buildSummaryEmptyState({
        tabTitle: currentSourceTitle ?? tabTitle ?? null,
        tabUrl: currentSourceUrl ?? tabUrl ?? activeTabUrl ?? null,
        autoSummarize,
        phase,
        hasSlides,
        progress,
      }),
    });
    return;
  }
  try {
    hostEl.innerHTML = "";
    const actions = document.createElement("div");
    actions.className = "render__actions";
    actions.append(createCopyButton({ text: displayMarkdown, headerSetStatus }));
    const markdownHost = document.createElement("div");
    markdownHost.className = "render__markdownBody";
    markdownHost.innerHTML = md.render(
      normalizeTextDiagramBlocks(linkifyTimestamps(normalizeInlineMermaidBlocks(displayMarkdown))),
    );
    enhanceRenderedSummaryBlocks(markdownHost);
    hostEl.append(actions, markdownHost);
    void renderMermaidPreviews(markdownHost);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    headerSetStatus(`错误：${message}`);
    return;
  }
  for (const a of Array.from(hostEl.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("timestamp:")) {
      a.classList.add("chatTimestamp");
      a.removeAttribute("target");
      a.removeAttribute("rel");
      continue;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  renderInlineSlides(hostEl, { fallback: true });
}
