// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUserMessageFromChatPayload,
  chatPayloadHasContent,
  createChatImageAttachmentRuntime,
  fileToChatImageAttachment,
  formatChatPayloadPreview,
  imageAttachmentToDataUrl,
  normalizeChatInputPayload,
} from "../apps/chrome-extension/src/entrypoints/sidepanel/chat-image-attachments";

const image = {
  id: "img-1",
  name: "screenshot.png",
  mimeType: "image/png",
  data: "abc123",
  sizeBytes: 6,
};

describe("sidepanel chat image attachments", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("img-generated");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function makeImageFile(name = "screenshot.png", type = "image/png", body = "hello") {
    return new File([body], name, { type });
  }

  it("builds multimodal user messages from text and images", () => {
    const message = buildUserMessageFromChatPayload({
      text: "What is wrong here?",
      images: [image],
    });

    expect(message.content).toEqual([
      { type: "text", text: "What is wrong here?" },
      { type: "image", data: "abc123", mimeType: "image/png" },
    ]);
  });

  it("uses a default prompt for image-only messages", () => {
    const message = buildUserMessageFromChatPayload({ text: "", images: [image] });

    expect(message.content).toEqual([
      { type: "text", text: "请根据这张图片回答。" },
      { type: "image", data: "abc123", mimeType: "image/png" },
    ]);
    expect(formatChatPayloadPreview({ text: "", images: [image] })).toBe(
      "请根据这张图片回答。 [1 image]",
    );
  });

  it("normalizes payloads, previews, and empty-content checks", () => {
    const second = { ...image, id: "img-2" };
    const third = { ...image, id: "img-3" };

    expect(normalizeChatInputPayload({ text: "  hello  ", images: [] })).toEqual({
      text: "hello",
      images: [],
    });
    expect(normalizeChatInputPayload({ text: "", images: [image, second, third] })).toEqual({
      text: "请根据这张图片回答。",
      images: [image, second],
    });
    expect(chatPayloadHasContent({ text: "", images: [] })).toBe(false);
    expect(chatPayloadHasContent({ text: "  hi  ", images: [] })).toBe(true);
    expect(chatPayloadHasContent({ text: "", images: [image] })).toBe(true);
    expect(formatChatPayloadPreview({ text: "see", images: [image, second] })).toBe(
      "see [2 images]",
    );
    expect(imageAttachmentToDataUrl(image)).toBe("data:image/png;base64,abc123");
  });

  it("creates a text-only user message when no images are attached", () => {
    expect(buildUserMessageFromChatPayload({ text: "  hello  ", images: [] })).toMatchObject({
      role: "user",
      content: "hello",
    });
  });

  it("wraps selected page text into the user message", () => {
    const message = buildUserMessageFromChatPayload({
      text: "Explain this",
      images: [],
      selectedText: {
        text: "Selected paragraph from the page.",
        truncated: false,
        url: "https://example.com/article",
        title: "Article",
      },
    });

    expect(message.content).toContain("<selected_text>");
    expect(message.content).toContain("Selected paragraph from the page.");
    expect(message.content).toContain("用户问题：\nExplain this");
    expect(
      formatChatPayloadPreview({
        text: "Explain this",
        images: [],
        selectedText: {
          text: "Selected paragraph from the page.",
        },
      }),
    ).toBe("Explain this [selected text]");
  });

  it("uses a default prompt for selected-text-only messages", () => {
    const normalized = normalizeChatInputPayload({
      text: "",
      images: [],
      selectedText: { text: "Only selected text" },
    });

    expect(normalized).toEqual({
      text: "请根据选中的文本回答。",
      images: [],
      selectedText: {
        text: "Only selected text",
        truncated: false,
        url: null,
        title: null,
      },
    });
    expect(
      chatPayloadHasContent({ text: "", images: [], selectedText: { text: "selected" } }),
    ).toBe(true);
  });

  it("reads small supported image files without canvas normalization", async () => {
    const attachment = await fileToChatImageAttachment(makeImageFile());

    expect(attachment).toMatchObject({
      id: "img-generated",
      name: "screenshot.png",
      mimeType: "image/png",
      data: "aGVsbG8=",
      sizeBytes: 5,
    });
  });

  it("rejects unsupported image formats", async () => {
    await expect(
      fileToChatImageAttachment(makeImageFile("screen.bmp", "image/bmp")),
    ).rejects.toThrow(/不支持的图片格式/);
  });

  it("normalizes large images through a canvas", async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 3200;
      naturalHeight = 1600;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("Image", FakeImage);
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,YWJj",
    );

    const attachment = await fileToChatImageAttachment(
      makeImageFile("large.png", "image/png", "x".repeat(1_300_000)),
    );

    expect(attachment.mimeType).toBe("image/jpeg");
    expect(attachment.data).toBe("YWJj");
    expect(attachment.width).toBe(1600);
    expect(attachment.height).toBe(800);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1600, 800);
    expect(drawImage).toHaveBeenCalled();
  });

  it("renders previews, removes images, and restores images", async () => {
    const attachBtn = document.createElement("button");
    const fileInputEl = document.createElement("input");
    fileInputEl.type = "file";
    const inputEl = document.createElement("textarea");
    const previewsEl = document.createElement("div");
    document.body.append(attachBtn, fileInputEl, inputEl, previewsEl);
    const setStatus = vi.fn();

    const runtime = createChatImageAttachmentRuntime({
      attachBtn,
      fileInputEl,
      inputEl,
      previewsEl,
      setStatus,
    });

    await runtime.addFiles([makeImageFile()]);
    expect(runtime.getImages()).toHaveLength(1);
    expect(previewsEl.classList.contains("isHidden")).toBe(false);
    expect(previewsEl.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );

    previewsEl.querySelector<HTMLButtonElement>(".chatImagePreview__remove")?.click();
    expect(runtime.getImages()).toHaveLength(0);
    expect(previewsEl.classList.contains("isHidden")).toBe(true);

    runtime.restoreImages([image, { ...image, id: "img-2" }, { ...image, id: "img-3" }]);
    expect(runtime.getImages()).toHaveLength(2);
    runtime.clearImages();
    expect(runtime.getImages()).toHaveLength(0);
  });

  it("reports skipped, full, and failed attachment additions", async () => {
    const status = vi.fn();
    const runtime = createChatImageAttachmentRuntime({
      attachBtn: document.createElement("button"),
      fileInputEl: document.createElement("input"),
      inputEl: document.createElement("textarea"),
      previewsEl: document.createElement("div"),
      setStatus: status,
    });

    await runtime.addFiles([
      makeImageFile("a.png"),
      makeImageFile("b.png"),
      makeImageFile("c.png"),
    ]);
    expect(status).toHaveBeenCalledWith("已添加 2 张图片，跳过 1 张。");

    await runtime.addFiles([makeImageFile("d.png")]);
    expect(status).toHaveBeenCalledWith("最多同时附加 2 张图片。");

    runtime.clearImages();
    await runtime.addFiles([makeImageFile("bad.bmp", "image/bmp")]);
    expect(status).toHaveBeenCalledWith(expect.stringMatching(/^图片添加失败：不支持的图片格式/));
  });

  it("handles click, file input, paste, dragover, and drop events", async () => {
    const attachBtn = document.createElement("button");
    const fileInputEl = document.createElement("input");
    fileInputEl.type = "file";
    const inputEl = document.createElement("textarea");
    const previewsEl = document.createElement("div");
    const dropTargetEl = document.createElement("div");
    const runtime = createChatImageAttachmentRuntime({
      attachBtn,
      fileInputEl,
      inputEl,
      previewsEl,
      dropTargetEl,
    });
    const clickSpy = vi.spyOn(fileInputEl, "click").mockImplementation(() => {});

    attachBtn.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(fileInputEl, "files", {
      configurable: true,
      value: [makeImageFile("from-input.png")],
    });
    fileInputEl.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(runtime.getImages()).toHaveLength(1));
    expect(fileInputEl.value).toBe("");

    runtime.clearImages();
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [makeImageFile("from-paste.png")] },
    });
    inputEl.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(runtime.getImages()).toHaveLength(1));

    runtime.clearImages();
    const dragover = new Event("dragover", { cancelable: true });
    Object.defineProperty(dragover, "dataTransfer", {
      value: { files: [makeImageFile("from-drag.png")] },
    });
    dropTargetEl.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);

    const drop = new Event("drop", { cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [makeImageFile("from-drop.png")] },
    });
    dropTargetEl.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(runtime.getImages()).toHaveLength(1));
  });
});
