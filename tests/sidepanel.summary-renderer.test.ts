// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({
    svg: `<svg id="${id}" role="img"><g><text>diagram</text></g></svg>`,
  })),
}));

import {
  enhanceRenderedSummaryBlocks,
  normalizeInlineMermaidBlocks,
  normalizeTextDiagramBlocks,
  renderSummaryEmptyState,
  renderSummaryMarkdownDisplay,
  setMermaidRuntimeLoaderForTest,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/summary-renderer.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("sidepanel summary renderer", () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    mermaidMocks.render.mockResolvedValue({
      svg: '<svg role="img"><g><text>diagram</text></g></svg>',
    });
    setMermaidRuntimeLoaderForTest(async () => ({
      initialize: mermaidMocks.initialize,
      render: mermaidMocks.render,
    }));
  });

  it("renders and clears empty states", () => {
    const hostEl = document.createElement("div");
    renderSummaryEmptyState({
      hostEl,
      state: { label: "Loading", message: "Preparing summary", detail: "Video title" },
    });
    expect(hostEl.textContent).toContain("Loading");
    expect(hostEl.textContent).toContain("Preparing summary");
    expect(hostEl.textContent).toContain("Video title");

    renderSummaryEmptyState({ hostEl, state: null });
    expect(hostEl.innerHTML).toBe("");
  });

  it("renders empty states without an optional detail line", () => {
    const hostEl = document.createElement("div");
    renderSummaryEmptyState({
      hostEl,
      state: { label: "Ready", message: "Click Summarize to start.", detail: "" },
    });
    expect(hostEl.querySelector(".renderEmpty__detail")).toBeNull();
  });

  it("renders markdown links and timestamp anchors", () => {
    const hostEl = document.createElement("div");
    const renderInlineSlides = vi.fn();
    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "[00:10] intro\n\n[link](https://example.com)",
      md: {
        render: (value) =>
          value
            .replace("[00:10](timestamp:10)", '<a href="timestamp:10">00:10</a>')
            .replace("[link](https://example.com)", '<a href="https://example.com">link</a>'),
      },
      phase: "done",
      renderInlineSlides,
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    const links = Array.from(hostEl.querySelectorAll("a"));
    expect(links[0]?.classList.contains("chatTimestamp")).toBe(true);
    expect(links[0]?.getAttribute("target")).toBeNull();
    expect(links[1]?.getAttribute("target")).toBe("_blank");
    expect(renderInlineSlides).toHaveBeenCalledWith(hostEl, { fallback: true });
    expect(hostEl.querySelector(".render__copy")).not.toBeNull();
  });

  it("strips leaked final_answer tags before rendering and copying", async () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();
    const writeText = vi.fn(async () => {});
    let renderedMarkdown = "";
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown:
        "<final_answer> final_answer> <final_answer>\n### Key moments\n- [0:10] Intro\n</final_answer>",
      md: {
        render: (value) => {
          renderedMarkdown = value;
          return `<p>${value}</p>`;
        },
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    expect(renderedMarkdown).toBe("### Key moments\n- [0:10](timestamp:10) Intro");
    expect(hostEl.textContent).not.toContain("final_answer");

    hostEl.querySelector<HTMLButtonElement>(".render__copy")?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("### Key moments\n- [0:10] Intro");
  });

  it("shows the empty streaming state instead of classification-only output", () => {
    const hostEl = document.createElement("div");

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "系统/架构设计：否\n算法/研究论文：否\n工程实践/经验总结：是",
      md: {
        render: (value) => `<p>${value}</p>`,
      },
      phase: "streaming",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    expect(hostEl.textContent).not.toContain("系统/架构设计");
    expect(hostEl.textContent).not.toContain("工程实践/经验总结");
  });

  it("renders mermaid code fences as diagram previews", async () => {
    const hostEl = document.createElement("div");
    document.body.append(hostEl);
    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "```Mermaid\nflowchart TD\nA --> B\n```",
      md: {
        render: () => '<pre><code class="language-Mermaid">flowchart TD\nA --&gt; B</code></pre>',
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    await vi.waitFor(() => {
      expect(hostEl.querySelector(".renderMermaid__viewport svg")).not.toBeNull();
    });

    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        flowchart: expect.objectContaining({ useMaxWidth: false }),
        securityLevel: "strict",
        startOnLoad: false,
      }),
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^summary-mermaid-/),
      "flowchart TD\nA --> B",
    );
    expect(hostEl.querySelector("pre > code")).toBeNull();
  });

  it("uses Mermaid viewBox width so large diagrams can scroll instead of shrinking", async () => {
    const hostEl = document.createElement("div");
    document.body.append(hostEl);
    mermaidMocks.render.mockResolvedValueOnce({
      svg: '<svg role="img" viewBox="0 0 960 420" style="max-width: 100%;"><g><text>diagram</text></g></svg>',
    });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "```mermaid\nflowchart TD\nA --> B\n```",
      md: {
        render: () => '<pre><code class="language-mermaid">flowchart TD\nA --&gt; B</code></pre>',
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    await vi.waitFor(() => {
      expect(hostEl.querySelector(".renderMermaid__viewport svg")).not.toBeNull();
    });

    const svg = hostEl.querySelector<SVGSVGElement>(".renderMermaid__viewport svg");
    expect(svg?.style.width).toBe("960px");
    expect(svg?.style.maxWidth).toBe("none");
    expect(svg?.style.height).toBe("auto");
  });

  it("opens Mermaid diagrams in a fullscreen viewer", async () => {
    const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    try {
      const hostEl = document.createElement("div");
      document.body.append(hostEl);
      mermaidMocks.render.mockResolvedValueOnce({
        svg: '<svg role="img" viewBox="0 0 1040 520"><g><text>diagram</text></g></svg>',
      });

      renderSummaryMarkdownDisplay({
        activeTabUrl: "https://example.com/watch",
        autoSummarize: false,
        currentSourceTitle: "Video",
        currentSourceUrl: "https://example.com/watch",
        hasSlides: false,
        headerSetStatus: vi.fn(),
        hostEl,
        inputMode: "video",
        markdown: "```mermaid\nflowchart TD\nA --> B\n```",
        md: {
          render: () => '<pre><code class="language-mermaid">flowchart TD\nA --&gt; B</code></pre>',
        },
        phase: "done",
        renderInlineSlides: vi.fn(),
        slidesEnabled: false,
        slidesLayout: "gallery",
        tabTitle: "Video",
        tabUrl: "https://example.com/watch",
      });

      await vi.waitFor(() => {
        expect(hostEl.querySelector(".renderMermaid__fullscreen")).not.toBeNull();
      });

      hostEl.querySelector<HTMLButtonElement>(".renderMermaid__fullscreen")?.click();

      const modal = document.querySelector(".renderMermaidModal");
      expect(modal?.getAttribute("role")).toBe("dialog");
      expect(modal?.getAttribute("aria-modal")).toBe("true");
      expect(modal?.querySelector(".renderMermaidModal__canvas svg")?.getAttribute("viewBox")).toBe(
        "0 0 1040 520",
      );
      expect(requestFullscreen).toHaveBeenCalledTimes(1);

      modal?.querySelector<HTMLButtonElement>(".renderMermaidModal__close")?.click();
      expect(document.querySelector(".renderMermaidModal")).toBeNull();
    } finally {
      if (originalRequestFullscreen) {
        Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
          configurable: true,
          value: originalRequestFullscreen,
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
      }
    }
  });

  it("normalizes inline Mermaid paragraphs before rendering previews", async () => {
    const hostEl = document.createElement("div");
    document.body.append(hostEl);
    let renderedMarkdown = "";

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown:
        "6. Mermaid 架构图： flowchart TD A[线上环境] --> B[OSS 文件系统 + 远程沙箱] C[本地环境] --> D[LocalStorageAdapter + LocalCommandExecutor]",
      md: {
        render: (value) => {
          renderedMarkdown = value;
          const source = value.match(/```mermaid\n([\s\S]*?)\n```/)?.[1] ?? "";
          return `<p>6. Mermaid 架构图：</p><pre><code class="language-mermaid">${escapeHtml(
            source,
          )}</code></pre>`;
        },
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    await vi.waitFor(() => {
      expect(hostEl.querySelector(".renderMermaid__viewport svg")).not.toBeNull();
    });

    expect(renderedMarkdown).toContain(
      [
        "```mermaid",
        "flowchart TD",
        "A[线上环境] --> B[OSS 文件系统 + 远程沙箱]",
        "C[本地环境] --> D[LocalStorageAdapter + LocalCommandExecutor]",
        "```",
      ].join("\n"),
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^summary-mermaid-/),
      [
        "flowchart TD",
        "A[线上环境] --> B[OSS 文件系统 + 远程沙箱]",
        "C[本地环境] --> D[LocalStorageAdapter + LocalCommandExecutor]",
      ].join("\n"),
    );
  });

  it("moves Mermaid init directives into the generated diagram fence", () => {
    expect(
      normalizeInlineMermaidBlocks(
        "%%{init: {'theme': 'default'}}%%\nflowchart TD\nA[Start] --> B[End]",
      ),
    ).toBe(
      [
        "```mermaid",
        "%%{init: {'theme': 'default'}}%%",
        "flowchart TD",
        "A[Start] --> B[End]",
        "```",
      ].join("\n"),
    );
  });

  it("normalizes ASCII diagram blocks into stable chart fences", () => {
    const input = [
      "## 腾讯Buddy家族全景",
      "",
      "┌────────────┬────────────┐",
      "| DataBuddy || CodeBuddy |",
      "| 做分析     || 写代码    |",
      "└────────────┴────────────┘",
      "",
      "后续说明。",
    ].join("\n");

    expect(normalizeTextDiagramBlocks(input)).toBe(
      [
        "## 腾讯Buddy家族全景",
        "",
        "```summary-chart",
        "┌────────────┬────────────┐",
        "| DataBuddy || CodeBuddy |",
        "| 做分析     || 写代码    |",
        "└────────────┴────────────┘",
        "```",
        "",
        "后续说明。",
      ].join("\n"),
    );
  });

  it("does not turn valid Markdown tables into chart fences", () => {
    const input = [
      "| Product | Audience |",
      "| --- | --- |",
      "| DataBuddy | 数据从业者 |",
      "| CodeBuddy | 开发者 |",
    ].join("\n");

    expect(normalizeTextDiagramBlocks(input)).toBe(input);
  });

  it("decorates rendered Markdown tables and ASCII charts for horizontal scrolling", () => {
    const hostEl = document.createElement("div");
    hostEl.innerHTML = [
      "<table><thead><tr><th>Product</th><th>Audience</th></tr></thead><tbody><tr><td>DataBuddy</td><td>数据从业者</td></tr></tbody></table>",
      '<pre><code class="language-summary-chart">| DataBuddy || CodeBuddy |\n| 做分析     || 写代码    |</code></pre>',
    ].join("");

    enhanceRenderedSummaryBlocks(hostEl);

    expect(hostEl.querySelector(".renderTableScroll > table")).not.toBeNull();
    expect(
      hostEl.querySelector("pre.renderAsciiChart > code.language-summary-chart"),
    ).not.toBeNull();
  });

  it("leaves mermaid source visible when diagram rendering fails", async () => {
    const hostEl = document.createElement("div");
    document.body.append(hostEl);
    mermaidMocks.render.mockRejectedValueOnce(new Error("bad diagram"));

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "```mermaid\nnot valid\n```",
      md: { render: () => '<pre><code class="language-mermaid">not valid</code></pre>' },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    await vi.waitFor(() => {
      expect(
        hostEl.querySelector("pre.renderMermaid__fallback > code.language-mermaid"),
      ).not.toBeNull();
    });

    expect(hostEl.querySelector(".renderMermaid")).toBeNull();
  });

  it("sanitizes rendered mermaid svg before inserting it", async () => {
    const hostEl = document.createElement("div");
    document.body.append(hostEl);
    mermaidMocks.render.mockResolvedValueOnce({
      svg: [
        '<svg role="img" onclick="alert(1)">',
        "<script>alert(1)</script>",
        '<a href="javascript:alert(1)"><text>Unsafe</text></a>',
        '<foreignObject><div onclick="alert(1)">html</div></foreignObject>',
        "</svg>",
      ].join(""),
    });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: vi.fn(),
      hostEl,
      inputMode: "video",
      markdown: "```mermaid\nflowchart TD\nA --> B\n```",
      md: {
        render: () => '<pre><code class="language-mermaid">flowchart TD\nA --&gt; B</code></pre>',
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    await vi.waitFor(() => {
      expect(hostEl.querySelector(".renderMermaid__viewport svg")).not.toBeNull();
    });

    expect(hostEl.querySelector("script")).toBeNull();
    expect(hostEl.querySelector("foreignObject")).not.toBeNull();
    expect(hostEl.querySelector("svg")?.getAttribute("onclick")).toBeNull();
    expect(hostEl.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(hostEl.querySelector("foreignObject div")?.getAttribute("onclick")).toBeNull();
  });

  it("copies rendered markdown text to the clipboard", async () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "# Title\n\nBody",
      md: { render: (value) => `<p>${value}</p>` },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    hostEl.querySelector<HTMLButtonElement>(".render__copy")?.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("# Title\n\nBody");
    expect(setStatus).toHaveBeenCalledWith("已复制");
  });

  it("reports empty copy attempts without touching the clipboard", async () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "   ",
      md: { render: (value) => `<p>${value}</p>` },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    expect(hostEl.textContent).toContain("摘要");
    expect(writeText).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalledWith("已复制");
  });

  it("falls back to execCommand copy when clipboard write fails", async () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();
    const writeText = vi.fn(async () => {
      throw new Error("blocked");
    });
    const execCommand = vi.fn(() => true);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });
    Object.assign(document, { execCommand });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "Body",
      md: { render: (value) => `<p>${value}</p>` },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    hostEl.querySelector<HTMLButtonElement>(".render__copy")?.click();
    await Promise.resolve();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setStatus).toHaveBeenCalledWith("已复制");
  });

  it("surfaces a failed execCommand fallback", async () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();
    const writeText = vi.fn(async () => {
      throw new Error("blocked");
    });
    const execCommand = vi.fn(() => false);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });
    Object.assign(document, { execCommand });

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "Body",
      md: { render: (value) => `<p>${value}</p>` },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });

    hostEl.querySelector<HTMLButtonElement>(".render__copy")?.click();
    await Promise.resolve();

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(setStatus).toHaveBeenCalledWith("复制失败");
  });

  it("falls back to the empty state and reports markdown render errors", () => {
    const hostEl = document.createElement("div");
    const setStatus = vi.fn();

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: true,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "",
      md: { render: (value) => value },
      phase: "connecting",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });
    expect(hostEl.textContent).toContain("正在准备摘要");

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "body",
      md: {
        render: () => {
          throw new Error("broken markdown");
        },
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining("broken markdown"));

    renderSummaryMarkdownDisplay({
      activeTabUrl: "https://example.com/watch",
      autoSummarize: false,
      currentSourceTitle: "Video",
      currentSourceUrl: "https://example.com/watch",
      hasSlides: false,
      headerSetStatus: setStatus,
      hostEl,
      inputMode: "video",
      markdown: "body",
      md: {
        render: () => {
          throw "bad markdown";
        },
      },
      phase: "done",
      renderInlineSlides: vi.fn(),
      slidesEnabled: false,
      slidesLayout: "gallery",
      tabTitle: "Video",
      tabUrl: "https://example.com/watch",
    });
    expect(setStatus).toHaveBeenCalledWith("错误：bad markdown");
  });
});
