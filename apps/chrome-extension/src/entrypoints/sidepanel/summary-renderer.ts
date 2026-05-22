import { sanitizeSummaryMarkdown } from "../../lib/runtime-contracts";
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
        useMaxWidth: true,
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
  return false;
}

function isFenceDelimiter(line: string): boolean {
  return /^\s{0,3}(`{3,}|~{3,})/.test(line);
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
  if (/^(?:flowchart|graph)\s+/i.test(trimmed)) {
    return normalizeFlowchartSource(trimmed);
  }
  return trimmed.replace(/\s*;\s*/g, "\n");
}

function normalizeInlineMermaidBlocks(markdown: string): string {
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

    const match = line.match(MERMAID_START_PATTERN);
    const startIndex = match?.index ?? -1;
    const prefix = startIndex >= 0 ? line.slice(0, startIndex).trimEnd() : "";
    if (startIndex < 0 || !prefixLooksLikeMermaidLabel(prefix)) {
      output.push(line);
      continue;
    }

    const chunks = [line.slice(startIndex).trim()];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (!next.trim() || isFenceDelimiter(next) || startsNewMarkdownBlock(next)) break;
      if (!looksLikeMermaidContinuation(next)) break;
      chunks.push(next.trim());
      index += 1;
    }

    const source = normalizeMermaidSource(chunks.join(" "));
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

async function renderMermaidPreviews(markdownHost: HTMLElement) {
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
    const source = code.textContent?.trim() ?? "";
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
      bindFunctions?.(viewport);
      figure.append(viewport);
      pre.replaceWith(figure);
    } catch {
      pre.classList.add("renderMermaid__fallback");
    }
  }
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
  if (!displayMarkdown.trim()) {
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
      linkifyTimestamps(normalizeInlineMermaidBlocks(displayMarkdown)),
    );
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
