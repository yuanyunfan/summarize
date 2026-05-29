import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildModelPickerOptions } from "../src/daemon/models.js";

describe("daemon /v1/models", () => {
  it("includes local OpenAI-compatible models without OPENAI_API_KEY", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return {
        ok: true,
        json: async () => ({ data: [{ id: "llama3.1" }] }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await buildModelPickerOptions({
      env: {},
      envForRun: { OPENAI_BASE_URL: "http://127.0.0.1:11434/v1" },
      configForCli: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.localModelsSource).toEqual({
      kind: "openai-compatible",
      baseUrlHost: "127.0.0.1:11434",
    });
    expect(result.options.some((o) => o.id === "openai/llama3.1")).toBe(true);
  });

  it("does not probe local models for OpenRouter base URLs", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not fetch /models for OpenRouter");
    }) as unknown as typeof fetch;

    const result = await buildModelPickerOptions({
      env: {},
      envForRun: { OPENAI_BASE_URL: "https://openrouter.ai/api/v1", OPENROUTER_API_KEY: "k" },
      configForCli: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.providers.openrouter).toBe(true);
    expect(result.localModelsSource).toBeNull();
    expect(result.options.some((o) => o.id === "free")).toBe(true);
  });

  it("includes available CLI model options", async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "summarize-cli-bin-"));
    const claudePath = path.join(binDir, "claude");
    const opencodePath = path.join(binDir, "opencode");
    const copilotPath = path.join(binDir, "copilot");
    writeFileSync(claudePath, "#!/bin/sh\nexit 0\n", "utf8");
    writeFileSync(opencodePath, "#!/bin/sh\nexit 0\n", "utf8");
    writeFileSync(copilotPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(claudePath, 0o755);
    chmodSync(opencodePath, 0o755);
    chmodSync(copilotPath, 0o755);

    const result = await buildModelPickerOptions({
      env: {},
      envForRun: { PATH: binDir },
      configForCli: null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.providers.cliClaude).toBe(true);
    expect(result.providers.cliOpencode).toBe(true);
    expect(result.providers.cliCopilot).toBe(true);
    expect(result.options.some((o) => o.id === "cli/claude")).toBe(true);
    expect(result.options.some((o) => o.id === "cli/opencode")).toBe(true);
    expect(result.options.some((o) => o.id === "cli/copilot")).toBe(true);
  });

  it("includes NVIDIA models when NVIDIA_API_KEY is set", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://integrate.api.nvidia.com/v1/models");
      expect(init?.headers).toEqual({ authorization: "Bearer nvidia-test" });
      return {
        ok: true,
        json: async () => ({ data: [{ id: "z-ai/glm5" }] }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await buildModelPickerOptions({
      env: {},
      envForRun: { NVIDIA_API_KEY: "nvidia-test" },
      configForCli: null,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.providers.nvidia).toBe(true);
    expect(result.options.some((o) => o.id === "nvidia/z-ai/glm5")).toBe(true);
  });

  it("surfaces copilot/* options only when logged in to GitHub Copilot", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "summarize-copilot-home-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    // Not logged in → no copilot options.
    const before = await buildModelPickerOptions({
      env: { HOME: home },
      envForRun: {},
      configForCli: null,
      fetchImpl,
    });
    expect(before.providers.copilotOAuth).toBe(false);
    expect(before.options.some((o) => o.id.startsWith("copilot/"))).toBe(false);

    // Write an auth.json with a Copilot credential.
    mkdirSync(path.join(home, ".summarize"), { recursive: true });
    writeFileSync(
      path.join(home, ".summarize", "auth.json"),
      JSON.stringify({
        version: 1,
        credentials: {
          "github-copilot-oauth": {
            type: "oauth",
            provider: "github-copilot-oauth",
            refresh: "gho_x",
            access: "gho_x",
            expires: 0,
          },
        },
      }),
      { encoding: "utf8" },
    );

    const after = await buildModelPickerOptions({
      env: { HOME: home },
      envForRun: {},
      configForCli: null,
      fetchImpl,
    });
    expect(after.providers.copilotOAuth).toBe(true);
    expect(after.options.some((o) => o.id === "copilot/gpt-4o")).toBe(true);
  });

  it("surfaces chatgpt/* and anthropic-oauth/* options after those logins", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "summarize-oauth-home-"));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    mkdirSync(path.join(home, ".summarize"), { recursive: true });
    writeFileSync(
      path.join(home, ".summarize", "auth.json"),
      JSON.stringify({
        version: 1,
        credentials: {
          "openai-chatgpt": {
            type: "oauth",
            provider: "openai-chatgpt",
            refresh: "r",
            access: "a",
            expires: 0,
            accountId: "acct",
          },
          "anthropic-oauth": {
            type: "oauth",
            provider: "anthropic-oauth",
            refresh: "r",
            access: "a",
            expires: 0,
          },
        },
      }),
      { encoding: "utf8" },
    );

    const result = await buildModelPickerOptions({
      env: { HOME: home },
      envForRun: {},
      configForCli: null,
      fetchImpl,
    });
    expect(result.providers.chatgptOAuth).toBe(true);
    expect(result.providers.anthropicOAuth).toBe(true);
    expect(result.options.some((o) => o.id.startsWith("chatgpt/"))).toBe(true);
    expect(result.options.some((o) => o.id.startsWith("anthropic-oauth/"))).toBe(true);
  });
});
