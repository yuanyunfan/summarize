import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

export type ChatSelectedText = {
  text: string;
  truncated?: boolean;
  url?: string | null;
  title?: string | null;
};

export type ChatInputPayload = {
  text: string;
  images: ChatImageAttachment[];
  selectedText?: ChatSelectedText | null;
};

type ChatImageAttachmentRuntimeOptions = {
  attachBtn: HTMLButtonElement;
  fileInputEl: HTMLInputElement;
  inputEl: HTMLTextAreaElement;
  previewsEl: HTMLElement;
  dropTargetEl?: HTMLElement;
  setStatus?: (value: string) => void;
};

const DEFAULT_IMAGE_PROMPT = "请根据这张图片回答。";
const DEFAULT_SELECTED_TEXT_PROMPT = "请根据选中的文本回答。";
const DEFAULT_SELECTED_TEXT_IMAGE_PROMPT = "请根据选中的文本和图片回答。";
const MAX_CHAT_IMAGES = 2;
const MAX_SELECTED_TEXT_CHARS = 8_000;
const MAX_IMAGE_BYTES = 1_200_000;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.88;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function imageAttachmentToDataUrl(image: Pick<ChatImageAttachment, "data" | "mimeType">) {
  return `data:${image.mimeType};base64,${image.data}`;
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error("Unsupported image encoding.");
  }
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image."));
    image.src = dataUrl;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mimeType: string, quality: number): string {
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch {
    return canvas.toDataURL("image/jpeg", quality);
  }
}

async function normalizeImageDataUrl(dataUrl: string, sourceMimeType: string) {
  const original = splitDataUrl(dataUrl);
  const originalBytes = estimateBase64Bytes(original.data);
  if (originalBytes <= MAX_IMAGE_BYTES && SUPPORTED_IMAGE_TYPES.has(original.mimeType)) {
    return { ...original, sizeBytes: originalBytes };
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to prepare image.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const outputType = sourceMimeType === "image/webp" ? "image/webp" : "image/jpeg";
  let quality = IMAGE_QUALITY;
  let normalized = splitDataUrl(canvasToDataUrl(canvas, outputType, quality));
  while (estimateBase64Bytes(normalized.data) > MAX_IMAGE_BYTES && quality > 0.58) {
    quality -= 0.08;
    normalized = splitDataUrl(canvasToDataUrl(canvas, outputType, quality));
  }
  return {
    ...normalized,
    sizeBytes: estimateBase64Bytes(normalized.data),
    width,
    height,
  };
}

function normalizeSelectedText(
  input: ChatSelectedText | null | undefined,
): ChatSelectedText | null {
  const text = input?.text.trim() ?? "";
  if (!text) return null;
  const truncatedByPayload = text.length > MAX_SELECTED_TEXT_CHARS;
  return {
    text: truncatedByPayload
      ? `${text.slice(0, Math.max(0, MAX_SELECTED_TEXT_CHARS - 24))}\n\n[TRUNCATED]`
      : text,
    truncated: Boolean(input?.truncated || truncatedByPayload),
    url: input?.url ?? null,
    title: input?.title ?? null,
  };
}

function defaultPromptForPayload(
  images: ChatImageAttachment[],
  selectedText: ChatSelectedText | null,
) {
  if (selectedText && images.length > 0) return DEFAULT_SELECTED_TEXT_IMAGE_PROMPT;
  if (selectedText) return DEFAULT_SELECTED_TEXT_PROMPT;
  if (images.length > 0) return DEFAULT_IMAGE_PROMPT;
  return "";
}

function buildTextWithSelectedContext(text: string, selectedText: ChatSelectedText | null): string {
  if (!selectedText) return text;
  return [
    "选中文本：",
    "<selected_text>",
    selectedText.text,
    "</selected_text>",
    "",
    "用户问题：",
    text,
  ].join("\n");
}

export function normalizeChatInputPayload(payload: ChatInputPayload): ChatInputPayload {
  const images = payload.images.slice(0, MAX_CHAT_IMAGES);
  const selectedText = normalizeSelectedText(payload.selectedText);
  const text = payload.text.trim() || defaultPromptForPayload(images, selectedText);
  return selectedText ? { text, images, selectedText } : { text, images };
}

export function chatPayloadHasContent(payload: ChatInputPayload): boolean {
  return (
    payload.text.trim().length > 0 ||
    payload.images.length > 0 ||
    Boolean(payload.selectedText?.text.trim())
  );
}

export function formatChatPayloadPreview(payload: ChatInputPayload): string {
  const normalized = normalizeChatInputPayload(payload);
  const selectionSuffix = normalized.selectedText ? " [selected text]" : "";
  const imageSuffix =
    normalized.images.length > 0
      ? ` [${normalized.images.length} image${normalized.images.length > 1 ? "s" : ""}]`
      : "";
  return `${normalized.text}${selectionSuffix}${imageSuffix}`.trim();
}

export function buildUserMessageFromChatPayload(
  payload: ChatInputPayload,
  timestamp = Date.now(),
): UserMessage {
  const normalized = normalizeChatInputPayload(payload);
  const text = buildTextWithSelectedContext(normalized.text, normalized.selectedText ?? null);
  if (normalized.images.length === 0) {
    return { role: "user", content: text, timestamp };
  }
  const parts: Array<TextContent | ImageContent> = [{ type: "text", text }];
  for (const image of normalized.images) {
    parts.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return { role: "user", content: parts, timestamp };
}

export async function fileToChatImageAttachment(file: File): Promise<ChatImageAttachment> {
  const mimeType = file.type.toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`不支持的图片格式：${file.type || file.name || "unknown"}`);
  }
  const dataUrl = await readFileAsDataUrl(file);
  const normalized = await normalizeImageDataUrl(dataUrl, mimeType);
  if (normalized.sizeBytes > MAX_IMAGE_BYTES * 1.25) {
    throw new Error("图片过大，压缩后仍无法发送。");
  }
  return {
    id: crypto.randomUUID(),
    name: file.name || "screenshot",
    mimeType: normalized.mimeType,
    data: normalized.data,
    sizeBytes: normalized.sizeBytes,
    ...(normalized.width ? { width: normalized.width } : {}),
    ...(normalized.height ? { height: normalized.height } : {}),
  };
}

function imageFilesFromList(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => file.type.toLowerCase().startsWith("image/"));
}

export function createChatImageAttachmentRuntime(opts: ChatImageAttachmentRuntimeOptions) {
  let images: ChatImageAttachment[] = [];

  function render() {
    opts.previewsEl.classList.toggle("isHidden", images.length === 0);
    opts.previewsEl.replaceChildren();
    for (const image of images) {
      const item = document.createElement("div");
      item.className = "chatImagePreview";
      item.dataset.id = image.id;

      const thumb = document.createElement("img");
      thumb.className = "chatImagePreview__image";
      thumb.src = imageAttachmentToDataUrl(image);
      thumb.alt = image.name || "Attached image";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chatImagePreview__remove";
      remove.textContent = "x";
      remove.setAttribute("aria-label", "移除图片");
      remove.addEventListener("click", () => {
        images = images.filter((entry) => entry.id !== image.id);
        render();
      });

      item.append(thumb, remove);
      opts.previewsEl.append(item);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const imageFiles = imageFilesFromList(files);
    if (imageFiles.length === 0) return;
    const available = Math.max(0, MAX_CHAT_IMAGES - images.length);
    if (available === 0) {
      opts.setStatus?.(`最多同时附加 ${MAX_CHAT_IMAGES} 张图片。`);
      return;
    }
    const selected = imageFiles.slice(0, available);
    const skipped = imageFiles.length - selected.length;
    try {
      const next = await Promise.all(selected.map((file) => fileToChatImageAttachment(file)));
      images = [...images, ...next];
      if (skipped > 0) opts.setStatus?.(`已添加 ${next.length} 张图片，跳过 ${skipped} 张。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      opts.setStatus?.(`图片添加失败：${message}`);
    } finally {
      render();
    }
  }

  opts.attachBtn.addEventListener("click", () => {
    opts.fileInputEl.click();
  });
  opts.fileInputEl.addEventListener("change", () => {
    const files = opts.fileInputEl.files;
    opts.fileInputEl.value = "";
    void addFiles(files);
  });
  opts.inputEl.addEventListener("paste", (event) => {
    const files = imageFilesFromList(event.clipboardData?.files ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  });

  const dropTarget = opts.dropTargetEl ?? opts.inputEl;
  dropTarget.addEventListener("dragover", (event) => {
    if (imageFilesFromList(event.dataTransfer?.files ?? null).length === 0) return;
    event.preventDefault();
  });
  dropTarget.addEventListener("drop", (event) => {
    const files = imageFilesFromList(event.dataTransfer?.files ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  });

  render();

  return {
    addFiles,
    clearImages() {
      images = [];
      render();
    },
    getImages() {
      return [...images];
    },
    restoreImages(next: ChatImageAttachment[]) {
      images = next.slice(0, MAX_CHAT_IMAGES);
      render();
    },
  };
}
