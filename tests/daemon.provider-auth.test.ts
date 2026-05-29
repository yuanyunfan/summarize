import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverCopilotModelIds,
  resolveCopilotAccessToken,
} from "../src/daemon/provider-auth/copilot-token.js";
import {
  resolveAnthropicToken,
  resolveOpenAiChatGptToken,
} from "../src/daemon/provider-auth/oauth-tokens.js";
import {
  buildAnthropicAuthorizeUrl,
  exchangeAnthropicCode,
  refreshAnthropicToken,
  ANTHROPIC_PROVIDER,
} from "../src/daemon/provider-auth/plugins/anthropic-oauth.js";
import {
  pollDeviceAccessToken,
  requestDeviceAuthorization,
} from "../src/daemon/provider-auth/plugins/github-copilot-device.js";
import { GITHUB_COPILOT_PROVIDER } from "../src/daemon/provider-auth/plugins/github-copilot-device.js";
import { OPENAI_PROVIDER } from "../src/daemon/provider-auth/plugins/openai-chatgpt.js";
import {
  exchangeAuthorization,
  listAuthMethods,
  listAuthStatus,
  logoutProvider,
  pollAuthorization,
  startAuthorization,
} from "../src/daemon/provider-auth/registry.js";
import {
  getCredential,
  listCredentials,
  removeCredential,
  resolveAuthStorePath,
  setCredential,
} from "../src/daemon/provider-auth/store.js";

let tmpHome: string;
let env: Record<string, string | undefined>;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "summarize-auth-"));
  env = { HOME: tmpHome };
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("provider-auth/store", () => {
  it("writes credentials at ~/.summarize/auth.json with 0600 perms", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: "github-copilot-oauth",
      refresh: "gho_x",
      access: "gho_x",
      expires: 0,
    });
    const filePath = resolveAuthStorePath(env);
    const stat = await fs.stat(filePath);
    // Only owner read/write.
    expect(stat.mode & 0o777).toBe(0o600);
    const cred = await getCredential(env, "github-copilot-oauth");
    expect(cred).toMatchObject({ type: "oauth", refresh: "gho_x" });
  });

  it("round-trips, lists and removes credentials", async () => {
    await setCredential(env, { type: "api", provider: "foo", key: "k1" });
    await setCredential(env, { type: "api", provider: "bar", key: "k2" });
    expect((await listCredentials(env)).map((c) => c.provider).sort()).toEqual(["bar", "foo"]);
    expect(await removeCredential(env, "foo")).toBe(true);
    expect(await getCredential(env, "foo")).toBeNull();
    expect(await removeCredential(env, "foo")).toBe(false);
  });

  it("returns empty store for missing or corrupt files", async () => {
    expect(await getCredential(env, "anything")).toBeNull();
    const filePath = resolveAuthStorePath(env);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not json");
    expect(await listCredentials(env)).toEqual([]);
  });

  it("picks up external writes (cache invalidation by mtime)", async () => {
    await setCredential(env, { type: "api", provider: "foo", key: "k1" });
    expect(await getCredential(env, "foo")).toMatchObject({ key: "k1" });
    // Simulate a concurrent writer (e.g. CLI login) replacing the file.
    const filePath = resolveAuthStorePath(env);
    const future = new Date(Date.now() + 5000);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        credentials: { foo: { type: "api", provider: "foo", key: "k2" } },
      }),
    );
    await fs.utimes(filePath, future, future);
    expect(await getCredential(env, "foo")).toMatchObject({ key: "k2" });
  });
});

describe("github-copilot device flow", () => {
  it("requests a device authorization", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          device_code: "dev123",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          interval: 5,
          expires_in: 900,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const auth = await requestDeviceAuthorization({ fetchImpl, now: 1000 });
    expect(auth).toMatchObject({
      deviceCode: "dev123",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      interval: 5,
      expiresAt: 1000 + 900 * 1000,
    });
  });

  it("maps poll responses to pending / slow_down / done / error", async () => {
    const make = (body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

    expect(
      await pollDeviceAccessToken({
        deviceCode: "d",
        fetchImpl: make({ error: "authorization_pending" }),
      }),
    ).toEqual({ status: "pending" });

    expect(
      await pollDeviceAccessToken({ deviceCode: "d", fetchImpl: make({ error: "slow_down" }) }),
    ).toEqual({ status: "pending", slowDownBy: 5 });

    const done = await pollDeviceAccessToken({
      deviceCode: "d",
      fetchImpl: make({ access_token: "gho_token" }),
    });
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.credential.refresh).toBe("gho_token");
    }

    const err = await pollDeviceAccessToken({
      deviceCode: "d",
      fetchImpl: make({ error: "access_denied", error_description: "user denied" }),
    });
    expect(err.status).toBe("error");
  });
});

describe("copilot token exchange", () => {
  it("exchanges the GitHub token and caches until near expiry", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: "github-copilot-oauth",
      refresh: "gho_token",
      access: "",
      expires: 0,
    });
    let exchanges = 0;
    const fetchImpl = (async () => {
      exchanges += 1;
      return new Response(JSON.stringify({ token: `copilot_${exchanges}`, expires_at: 2000 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    // expires_at = 2000s → 2_000_000 ms.
    const first = await resolveCopilotAccessToken({ env, fetchImpl, now: 0 });
    expect(first).toBe("copilot_1");
    // Still fresh → no new exchange.
    const second = await resolveCopilotAccessToken({ env, fetchImpl, now: 1_000_000 });
    expect(second).toBe("copilot_1");
    expect(exchanges).toBe(1);
    // Past expiry (minus skew) → re-exchange.
    const third = await resolveCopilotAccessToken({ env, fetchImpl, now: 1_999_999 });
    expect(third).toBe("copilot_2");
    expect(exchanges).toBe(2);
  });

  it("returns null when not logged in", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await resolveCopilotAccessToken({ env, fetchImpl, now: 0 })).toBeNull();
  });

  it("falls back to the GitHub token directly when the exchange 404s, and caches it", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: "github-copilot-oauth",
      refresh: "gho_direct",
      access: "",
      expires: 0,
    });
    let exchangeCalls = 0;
    const fetchImpl = (async () => {
      exchangeCalls += 1;
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }) as unknown as typeof fetch;
    // Enterprise accounts: /v2/token 404s, so we use the GitHub token directly.
    expect(await resolveCopilotAccessToken({ env, fetchImpl, now: 0 })).toBe("gho_direct");
    expect(exchangeCalls).toBe(1);
    // Direct token is cached with a TTL → no second exchange attempt.
    expect(await resolveCopilotAccessToken({ env, fetchImpl, now: 1000 })).toBe("gho_direct");
    expect(exchangeCalls).toBe(1);
  });
});

describe("copilot model discovery", () => {
  it("lists picker-enabled model ids from the Copilot API", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: "github-copilot-oauth",
      refresh: "gho_token",
      access: "copilot_cached",
      expires: 9_999_999_999_999, // fresh → no exchange
    });
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("api.githubcopilot.com/models");
      return new Response(
        JSON.stringify({
          data: [
            { id: "gpt-5.5", model_picker_enabled: true },
            { id: "claude-opus-4.8", model_picker_enabled: true },
            { id: "gpt-4o-2024-08-06", model_picker_enabled: false },
            { id: "" },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const ids = await discoverCopilotModelIds({ env, fetchImpl, now: 0 });
    expect(ids).toEqual(["claude-opus-4.8", "gpt-5.5"]);
  });

  it("returns an empty list (caller falls back) when not logged in or on error", async () => {
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await discoverCopilotModelIds({ env, fetchImpl: ok, now: 0 })).toEqual([]);

    await setCredential(env, {
      type: "oauth",
      provider: "github-copilot-oauth",
      refresh: "gho",
      access: "tok",
      expires: 9_999_999_999_999,
    });
    const fail = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await discoverCopilotModelIds({ env, fetchImpl: fail, now: 0 })).toEqual([]);
  });
});

describe("provider-auth registry", () => {
  it("lists methods and reflects login status", async () => {
    const methods = listAuthMethods();
    expect(methods.some((m) => m.provider === GITHUB_COPILOT_PROVIDER && m.kind === "device")).toBe(
      true,
    );
    expect(methods.some((m) => m.provider === OPENAI_PROVIDER && m.kind === "loopback")).toBe(true);
    expect(methods.some((m) => m.provider === ANTHROPIC_PROVIDER && m.kind === "code")).toBe(true);

    const before = await listAuthStatus(env);
    expect(before.find((s) => s.provider === GITHUB_COPILOT_PROVIDER)?.loggedIn).toBe(false);

    await setCredential(env, {
      type: "oauth",
      provider: GITHUB_COPILOT_PROVIDER,
      refresh: "gho_x",
      access: "gho_x",
      expires: 0,
    });
    const after = await listAuthStatus(env);
    expect(after.find((s) => s.provider === GITHUB_COPILOT_PROVIDER)?.loggedIn).toBe(true);
  });

  it("runs a device-flow authorize → poll → done lifecycle", async () => {
    let pollCount = 0;
    const fetchImpl = (async (url: string) => {
      if (url.includes("/login/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "dev",
            user_code: "WXYZ-9999",
            verification_uri: "https://github.com/login/device",
            interval: 1,
            expires_in: 900,
          }),
          { status: 200 },
        );
      }
      // access_token endpoint: pending once, then success.
      pollCount += 1;
      const body =
        pollCount < 2 ? { error: "authorization_pending" } : { access_token: "gho_final" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const authorize = await startAuthorization({
      provider: GITHUB_COPILOT_PROVIDER,
      env,
      fetchImpl,
      now: 0,
    });
    expect(authorize.userCode).toBe("WXYZ-9999");

    // First poll before interval has elapsed → pending without hitting network.
    const tooSoon = await pollAuthorization({
      pendingId: authorize.pendingId,
      env,
      fetchImpl,
      now: 0,
    });
    expect(tooSoon.status).toBe("pending");
    expect(pollCount).toBe(0);

    // After interval → pending (server says authorization_pending).
    const pending = await pollAuthorization({
      pendingId: authorize.pendingId,
      env,
      fetchImpl,
      now: 2000,
    });
    expect(pending.status).toBe("pending");

    // Next poll → done, credential persisted.
    const done = await pollAuthorization({
      pendingId: authorize.pendingId,
      env,
      fetchImpl,
      now: 5000,
    });
    expect(done.status).toBe("done");
    const cred = await getCredential(env, GITHUB_COPILOT_PROVIDER);
    expect(cred?.type === "oauth" && cred.refresh).toBe("gho_final");

    // Pending flow consumed: re-poll errors.
    const after = await pollAuthorization({
      pendingId: authorize.pendingId,
      env,
      fetchImpl,
      now: 6000,
    });
    expect(after.status).toBe("error");
  });

  it("rejects unsupported providers and logs out", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(startAuthorization({ provider: "nope", env, fetchImpl, now: 0 })).rejects.toThrow(
      /Unsupported/,
    );

    await setCredential(env, {
      type: "oauth",
      provider: GITHUB_COPILOT_PROVIDER,
      refresh: "x",
      access: "x",
      expires: 0,
    });
    expect(await logoutProvider({ provider: GITHUB_COPILOT_PROVIDER, env })).toBe(true);
    expect(await logoutProvider({ provider: GITHUB_COPILOT_PROVIDER, env })).toBe(false);
  });
});

describe("anthropic paste-code flow", () => {
  it("builds an authorize URL with PKCE params", () => {
    const { url, verifier, state } = buildAnthropicAuthorizeUrl();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(verifier.length).toBeGreaterThan(20);
  });

  it("exchanges a pasted code#state for tokens", async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const cred = await exchangeAnthropicCode({
      pastedCode: "the-code#st-1",
      verifier: "v",
      expectedState: "st-1",
      fetchImpl,
      now: 1000,
    });
    expect(cred).toMatchObject({ provider: ANTHROPIC_PROVIDER, access: "acc", refresh: "ref" });
    expect(cred.expires).toBe(1000 + 3600 * 1000);
    expect(sentBody).toMatchObject({ grant_type: "authorization_code", code: "the-code" });
  });

  it("rejects a state mismatch", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(
      exchangeAnthropicCode({
        pastedCode: "code#wrong",
        verifier: "v",
        expectedState: "right",
        fetchImpl,
        now: 0,
      }),
    ).rejects.toThrow(/State mismatch/);
  });

  it("runs authorize → exchange through the registry", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const authorize = await startAuthorization({
      provider: ANTHROPIC_PROVIDER,
      env,
      fetchImpl,
      now: 0,
    });
    expect(authorize.kind).toBe("code");
    expect(authorize.verificationUri).toContain("claude.ai/oauth/authorize");

    const exchange = await exchangeAuthorization({
      pendingId: authorize.pendingId,
      code: "code-without-state",
      env,
      fetchImpl,
      now: 0,
    });
    expect(exchange.status).toBe("done");
    const cred = await getCredential(env, ANTHROPIC_PROVIDER);
    expect(cred?.type === "oauth" && cred.access).toBe("acc");
  });
});

describe("oauth token refresh", () => {
  it("refreshes an expired ChatGPT token and preserves account id", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: OPENAI_PROVIDER,
      refresh: "ref",
      access: "old",
      expires: 1000, // already expired relative to now below
      accountId: "acct-1",
    });
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ access_token: "new-acc", refresh_token: "new-ref", expires_in: 3600 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const resolved = await resolveOpenAiChatGptToken({ env, fetchImpl, now: 1_000_000 });
    expect(resolved).toMatchObject({ accessToken: "new-acc", accountId: "acct-1" });
    expect(calls).toBe(1);
    // Fresh now → cached, no refresh.
    const again = await resolveOpenAiChatGptToken({ env, fetchImpl, now: 1_000_001 });
    expect(again?.accessToken).toBe("new-acc");
    expect(calls).toBe(1);
  });

  it("refreshes an expired Anthropic token", async () => {
    await setCredential(env, {
      type: "oauth",
      provider: ANTHROPIC_PROVIDER,
      refresh: "ref",
      access: "old",
      expires: 1000,
    });
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ access_token: "fresh", refresh_token: "ref2", expires_in: 3600 }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const resolved = await resolveAnthropicToken({ env, fetchImpl, now: 1_000_000 });
    expect(resolved?.accessToken).toBe("fresh");
  });

  it("returns null when not logged in", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await resolveOpenAiChatGptToken({ env, fetchImpl, now: 0 })).toBeNull();
    expect(await resolveAnthropicToken({ env, fetchImpl, now: 0 })).toBeNull();
  });
});

// Keep a reference so the refresh import is exercised even if helpers change.
void refreshAnthropicToken;
