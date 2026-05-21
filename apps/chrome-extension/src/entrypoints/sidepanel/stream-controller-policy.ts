import { mergeStreamingChunk } from "../../lib/runtime-contracts";

export function accumulateSummarizeChunk(markdown: string, chunk: string): string {
  return mergeStreamingChunk(markdown, chunk).next;
}

export function accumulateChatChunk(chatContent: string, chunk: string): string {
  return `${chatContent}${chunk}`;
}

export function shouldSurfaceStreamingStatus({
  streamedAnyNonWhitespace,
  statusText,
}: {
  streamedAnyNonWhitespace: boolean;
  statusText: string;
}): boolean {
  const trimmed = statusText.trim().toLowerCase();
  const allowDuringStreaming =
    trimmed.startsWith("slides:") || trimmed.startsWith("slides ") || trimmed.startsWith("slide:");
  return !streamedAnyNonWhitespace || allowDuringStreaming;
}

export function getTerminalStreamError(args: {
  sawDone: boolean;
  streamedAnyNonWhitespace: boolean;
}): Error | null {
  if (!args.sawDone) {
    return new Error("流式响应意外结束，daemon 可能已经停止。");
  }
  if (!args.streamedAnyNonWhitespace) {
    return new Error("模型没有返回内容。");
  }
  return null;
}
