import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlideTextMode } from "../apps/chrome-extension/src/entrypoints/sidepanel/slides-state";
import { createSummarizeControlRuntime } from "../apps/chrome-extension/src/entrypoints/sidepanel/summarize-control-runtime";
import type { Settings, SlidesLayout } from "../apps/chrome-extension/src/lib/settings";

type SummarizeControlProps = {
  mode: "page" | "video";
  slidesEnabled: boolean;
  mediaAvailable: boolean;
  busy?: boolean;
  videoLabel?: string;
  pageWords?: number | null;
  videoDurationSeconds?: number | null;
  slidesTextMode?: SlideTextMode;
  slidesTextToggleVisible?: boolean;
  onSlidesTextModeChange?: (value: SlideTextMode) => void;
  onChange: (value: { mode: "page" | "video"; slides: boolean }) => void | Promise<void>;
  onSummarize: () => void;
};

let currentProps: SummarizeControlProps | null = null;
const summarizeControlUpdate = vi.fn();

vi.mock("../apps/chrome-extension/src/entrypoints/sidepanel/pickers", () => ({
  mountSummarizeControl: (_root: HTMLElement, props: SummarizeControlProps) => {
    currentProps = props;
    return {
      update: (next: SummarizeControlProps) => {
        currentProps = next;
        summarizeControlUpdate(next);
      },
    };
  },
}));

function buildState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  return { ...baseState(), ...overrides };
}

function baseState() {
  return {
    inputMode: "page" as const,
    inputModeOverride: null as "page" | "video" | null,
    hasSummaryMarkdown: false,
    slidesEnabled: false,
    slidesOcrEnabled: true,
    autoSummarize: false,
    slidesBusy: false,
    mediaAvailable: true,
    slidesLayout: "gallery" as SlidesLayout,
    summarizeVideoLabel: "Video",
    summarizePageWords: 320,
    summarizeVideoDurationSeconds: 120,
    activeTabUrl: "https://example.com/video",
    currentSourceUrl: "https://example.com/video",
  };
}

function buildRuntime(
  overrides: {
    state?: Partial<ReturnType<typeof baseState>>;
    resolveActiveSlidesRunId?: () => string | null;
    slidesTextSetResult?: boolean;
  } = {},
) {
  currentProps = null;
  summarizeControlUpdate.mockReset();

  const state = buildState(overrides.state);
  const calls = {
    patchSettings: vi.fn(async (_patch: Partial<Settings>) => {}),
    loadSettings: vi.fn(async () => ({ token: "token" })),
    showSlideNotice: vi.fn(),
    hideSlideNotice: vi.fn(),
    setSlidesBusy: vi.fn((value: boolean) => {
      state.slidesBusy = value;
    }),
    stopSlidesStream: vi.fn(),
    maybeApplyPendingSlidesSummary: vi.fn(),
    maybeStartPendingSlidesForUrl: vi.fn(),
    sendSummarize: vi.fn(),
    startSlidesStreamForRunId: vi.fn(),
    startSlidesSummaryStreamForRunId: vi.fn(),
    renderMarkdownDisplay: vi.fn(),
    renderInlineSlidesFallback: vi.fn(),
    queueSlidesRender: vi.fn(),
    applySlidesRendererLayout: vi.fn(),
  };

  const renderMarkdownHostEl = {
    classList: { remove: vi.fn() },
  } as unknown as HTMLElement;
  const renderSlidesHostEl = { dataset: {} as Record<string, string> } as HTMLElement;
  const slidesLayoutEl = { value: state.slidesLayout } as HTMLSelectElement;

  const slidesTextController = {
    getTextMode: vi.fn(() => "transcript" as SlideTextMode),
    getTextToggleVisible: vi.fn(() => true),
    setTextMode: vi.fn(() => overrides.slidesTextSetResult ?? true),
  };

  const runtime = createSummarizeControlRuntime({
    summarizeControlRoot: {} as HTMLElement,
    renderMarkdownHostEl,
    renderSlidesHostEl,
    slidesLayoutEl,
    slidesTextController,
    getState: () => state,
    setInputMode: (value) => {
      state.inputMode = value;
    },
    setInputModeOverride: (value) => {
      state.inputModeOverride = value;
    },
    setSlidesEnabled: (value) => {
      state.slidesEnabled = value;
    },
    setSlidesLayoutValue: (value) => {
      state.slidesLayout = value;
    },
    patchSettings: calls.patchSettings,
    loadSettings: calls.loadSettings,
    showSlideNotice: calls.showSlideNotice,
    hideSlideNotice: calls.hideSlideNotice,
    setSlidesBusy: calls.setSlidesBusy,
    stopSlidesStream: calls.stopSlidesStream,
    maybeApplyPendingSlidesSummary: calls.maybeApplyPendingSlidesSummary,
    maybeStartPendingSlidesForUrl: calls.maybeStartPendingSlidesForUrl,
    sendSummarize: calls.sendSummarize,
    resolveActiveSlidesRunId: overrides.resolveActiveSlidesRunId ?? (() => null),
    startSlidesStreamForRunId: calls.startSlidesStreamForRunId,
    startSlidesSummaryStreamForRunId: calls.startSlidesSummaryStreamForRunId,
    renderMarkdownDisplay: calls.renderMarkdownDisplay,
    renderInlineSlidesFallback: calls.renderInlineSlidesFallback,
    queueSlidesRender: calls.queueSlidesRender,
    applySlidesRendererLayout: calls.applySlidesRendererLayout,
  });

  return {
    state,
    calls,
    runtime,
    currentProps: () => currentProps,
    renderMarkdownHostEl,
    renderSlidesHostEl,
    slidesLayoutEl,
    slidesTextController,
  };
}

describe("sidepanel summarize control runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    summarizeControlUpdate.mockReset();
    currentProps = null;
  });

  it("blocks enabling slides when required tools are missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        tools: {
          ytDlp: { available: true },
          ffmpeg: { available: false },
          tesseract: { available: true },
        },
      }),
    } as Response);
    const { state, calls } = buildRuntime();

    await currentProps?.onChange({ mode: "video", slides: true });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(calls.showSlideNotice).toHaveBeenCalledWith(
      "提取 Slides 需要 ffmpeg。请安装后重启 daemon。",
    );
    expect(calls.patchSettings).not.toHaveBeenCalled();
    expect(state.slidesEnabled).toBe(false);
  });

  it("disabling slides stops active work and persists the setting", async () => {
    const { state, calls } = buildRuntime({
      state: {
        slidesEnabled: true,
        slidesBusy: true,
        autoSummarize: true,
        inputMode: "video",
      },
    });

    await currentProps?.onChange({ mode: "page", slides: false });

    expect(calls.hideSlideNotice).toHaveBeenCalledOnce();
    expect(calls.setSlidesBusy).toHaveBeenCalledWith(false);
    expect(calls.stopSlidesStream).toHaveBeenCalledOnce();
    expect(calls.patchSettings).toHaveBeenCalledWith({ slidesEnabled: false });
    expect(calls.sendSummarize).toHaveBeenCalledWith({ refresh: true });
    expect(state.slidesEnabled).toBe(false);
    expect(state.inputModeOverride).toBe("page");
  });

  it("retries existing slide streams instead of re-summarizing", () => {
    const { calls, runtime } = buildRuntime({
      state: { slidesEnabled: true, currentSourceUrl: "https://example.com/current" },
      resolveActiveSlidesRunId: () => "slides-run-1",
    });

    runtime.retrySlidesStream();

    expect(calls.hideSlideNotice).toHaveBeenCalledOnce();
    expect(calls.startSlidesStreamForRunId).toHaveBeenCalledWith("slides-run-1");
    expect(calls.startSlidesSummaryStreamForRunId).toHaveBeenCalledWith(
      "slides-run-1",
      "https://example.com/current",
    );
    expect(calls.sendSummarize).not.toHaveBeenCalled();
  });

  it("refreshes summarize when retrying slides without an active run", () => {
    const { calls, runtime } = buildRuntime({
      state: { slidesEnabled: true },
    });

    runtime.retrySlidesStream();

    expect(calls.sendSummarize).toHaveBeenCalledWith({ refresh: true });
    expect(calls.startSlidesStreamForRunId).not.toHaveBeenCalled();
  });

  it("bypasses summary cache when the summarize button is clicked", () => {
    const { calls } = buildRuntime();

    currentProps?.onSummarize();

    expect(calls.sendSummarize).toHaveBeenCalledWith({ refresh: true });
  });

  it("switches slide text mode through fallback rendering when summary markdown exists", () => {
    const { calls, slidesTextController } = buildRuntime({
      state: { hasSummaryMarkdown: true },
    });

    currentProps?.onSlidesTextModeChange?.("ocr");

    expect(slidesTextController.setTextMode).toHaveBeenCalledWith("ocr");
    expect(calls.renderInlineSlidesFallback).toHaveBeenCalledOnce();
    expect(calls.queueSlidesRender).not.toHaveBeenCalled();
  });

  it("queues slides render when switching text mode without summary markdown", () => {
    const { calls, runtime, renderMarkdownHostEl, renderSlidesHostEl } = buildRuntime({
      state: { hasSummaryMarkdown: false, slidesEnabled: true, inputMode: "video" },
    });

    currentProps?.onSlidesTextModeChange?.("ocr");
    runtime.applySlidesLayout();

    expect(calls.queueSlidesRender).toHaveBeenCalledOnce();
    expect(calls.renderInlineSlidesFallback).not.toHaveBeenCalled();
    expect(renderMarkdownHostEl.classList.remove).toHaveBeenCalledWith("hidden");
    expect(renderSlidesHostEl.dataset.layout).toBe("gallery");
  });
});
