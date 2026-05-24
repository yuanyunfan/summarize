import type { DebugSnapshot } from "../../lib/debug-snapshot";

type DebugSnapshotResponse = { ok: true; snapshot: DebugSnapshot } | { ok: false; error?: string };

export function createDebugSnapshotController({
  copyBtn,
  outputEl,
  flashStatus,
}: {
  copyBtn: HTMLButtonElement;
  outputEl: HTMLPreElement;
  flashStatus: (message: string) => void;
}) {
  const setOutput = (text: string) => {
    outputEl.hidden = false;
    outputEl.textContent = text;
  };

  const copySnapshot = async () => {
    copyBtn.disabled = true;
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "debug:snapshot",
      })) as DebugSnapshotResponse | undefined;
      if (!response?.ok) {
        throw new Error(response?.error || "debug snapshot unavailable");
      }
      const text = JSON.stringify(response.snapshot, null, 2);
      setOutput(text);
      try {
        await navigator.clipboard?.writeText(text);
        flashStatus("诊断 snapshot 已复制");
      } catch {
        flashStatus("诊断 snapshot 已生成，复制失败");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutput(`Failed to collect debug snapshot: ${message}`);
      flashStatus(`诊断 snapshot 失败：${message}`);
    } finally {
      copyBtn.disabled = false;
    }
  };

  return {
    bind() {
      copyBtn.addEventListener("click", () => {
        void copySnapshot();
      });
    },
  };
}
