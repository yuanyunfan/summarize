import { randomUUID } from "node:crypto";
import {
  buildAnthropicAuthorizeUrl,
  exchangeAnthropicCode,
  ANTHROPIC_PROVIDER,
} from "./plugins/anthropic-oauth.js";
import {
  GITHUB_COPILOT_PROVIDER,
  pollDeviceAccessToken,
  requestDeviceAuthorization,
} from "./plugins/github-copilot-device.js";
import {
  OPENAI_PROVIDER,
  startOpenAiLoopback,
  type OpenAiLoopbackSession,
} from "./plugins/openai-chatgpt.js";
import { getCredential, listCredentials, removeCredential, setCredential } from "./store.js";

/**
 * Provider-auth registry. Mirrors opencode's `ProviderAuth` surface
 * (methods / authorize / poll / exchange / logout). Three login shapes are
 * supported, distinguished by `kind`:
 *   - "device"   GitHub Copilot: show a user code + URL, poll for completion.
 *   - "loopback" OpenAI ChatGPT: open a URL, a local server catches the redirect.
 *   - "code"     Anthropic: open a URL, the user pastes back a `code#state`.
 */

export type AuthMethodKind = "device" | "loopback" | "code";

export type AuthMethodDescriptor = {
  provider: string;
  label: string;
  kind: AuthMethodKind;
};

const PROVIDER_LABELS: Record<string, string> = {
  [GITHUB_COPILOT_PROVIDER]: "GitHub Copilot",
  [OPENAI_PROVIDER]: "OpenAI (ChatGPT)",
  [ANTHROPIC_PROVIDER]: "Anthropic (Claude)",
};

const AUTH_METHODS: AuthMethodDescriptor[] = [
  {
    provider: GITHUB_COPILOT_PROVIDER,
    label: PROVIDER_LABELS[GITHUB_COPILOT_PROVIDER],
    kind: "device",
  },
  { provider: OPENAI_PROVIDER, label: PROVIDER_LABELS[OPENAI_PROVIDER], kind: "loopback" },
  { provider: ANTHROPIC_PROVIDER, label: PROVIDER_LABELS[ANTHROPIC_PROVIDER], kind: "code" },
];

export function listAuthMethods(): AuthMethodDescriptor[] {
  return AUTH_METHODS.map((method) => ({ ...method }));
}

export type ProviderAuthStatus = {
  provider: string;
  label: string;
  loggedIn: boolean;
};

export async function listAuthStatus(
  env: Record<string, string | undefined>,
): Promise<ProviderAuthStatus[]> {
  const credentials = await listCredentials(env);
  const loggedIn = new Set(credentials.map((credential) => credential.provider));
  return AUTH_METHODS.map((method) => ({
    provider: method.provider,
    label: PROVIDER_LABELS[method.provider] ?? method.provider,
    loggedIn: loggedIn.has(method.provider),
  }));
}

type PendingDevice = {
  kind: "device";
  provider: string;
  deviceCode: string;
  interval: number;
  expiresAt: number;
  /** Earliest epoch ms at which the next poll is allowed (respects slow_down). */
  nextPollAt: number;
};

type PendingLoopback = {
  kind: "loopback";
  provider: string;
  expiresAt: number;
  session: OpenAiLoopbackSession;
  /** Set once the loopback `wait()` settles. */
  outcome: "pending" | "done" | "error";
  errorMessage?: string;
};

type PendingCode = {
  kind: "code";
  provider: string;
  expiresAt: number;
  verifier: string;
  state: string;
};

type PendingFlow = PendingDevice | PendingLoopback | PendingCode;

const PENDING_TTL_MS = 16 * 60 * 1000;
const pendingFlows = new Map<string, PendingFlow>();

function prunePendingFlows(now: number): void {
  for (const [id, flow] of pendingFlows) {
    if (flow.expiresAt + PENDING_TTL_MS < now) {
      if (flow.kind === "loopback") flow.session.close();
      pendingFlows.delete(id);
    }
  }
}

export type AuthorizeResult = {
  pendingId: string;
  provider: string;
  kind: AuthMethodKind;
  /** URL the user should open (all kinds). */
  verificationUri: string;
  /** Device flow only: the code the user types into the verification page. */
  userCode?: string;
  /** Device flow only: poll interval seconds. */
  interval?: number;
  expiresAt: number;
};

export async function startAuthorization({
  provider,
  env,
  fetchImpl,
  now,
}: {
  provider: string;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<AuthorizeResult> {
  prunePendingFlows(now);
  const pendingId = randomUUID();

  if (provider === GITHUB_COPILOT_PROVIDER) {
    const authorization = await requestDeviceAuthorization({ fetchImpl, now });
    pendingFlows.set(pendingId, {
      kind: "device",
      provider,
      deviceCode: authorization.deviceCode,
      interval: authorization.interval,
      expiresAt: authorization.expiresAt,
      nextPollAt: now + authorization.interval * 1000,
    });
    return {
      pendingId,
      provider,
      kind: "device",
      verificationUri: authorization.verificationUri,
      userCode: authorization.userCode,
      interval: authorization.interval,
      expiresAt: authorization.expiresAt,
    };
  }

  if (provider === OPENAI_PROVIDER) {
    const expiresAt = now + 5 * 60 * 1000;
    const session = await startOpenAiLoopback({ fetchImpl, now });
    const pending: PendingLoopback = {
      kind: "loopback",
      provider,
      expiresAt,
      session,
      outcome: "pending",
    };
    pendingFlows.set(pendingId, pending);
    // Resolve the callback in the background; poll() reads `outcome`.
    void session
      .wait()
      .then(async (credential) => {
        await setCredential(env, credential);
        pending.outcome = "done";
      })
      .catch((error: unknown) => {
        pending.outcome = "error";
        pending.errorMessage = error instanceof Error ? error.message : String(error);
      });
    return {
      pendingId,
      provider,
      kind: "loopback",
      verificationUri: session.url,
      expiresAt,
    };
  }

  if (provider === ANTHROPIC_PROVIDER) {
    const expiresAt = now + 10 * 60 * 1000;
    const { url, verifier, state } = buildAnthropicAuthorizeUrl();
    pendingFlows.set(pendingId, { kind: "code", provider, expiresAt, verifier, state });
    return {
      pendingId,
      provider,
      kind: "code",
      verificationUri: url,
      expiresAt,
    };
  }

  throw new Error(`Unsupported auth provider "${provider}"`);
}

export type PollAuthorizationResult =
  | { status: "pending"; interval?: number }
  | { status: "done"; provider: string }
  | { status: "error"; message: string };

export async function pollAuthorization({
  pendingId,
  env,
  fetchImpl,
  now,
}: {
  pendingId: string;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<PollAuthorizationResult> {
  const flow = pendingFlows.get(pendingId);
  if (!flow) {
    return { status: "error", message: "Login session not found or expired. Start again." };
  }
  if (flow.expiresAt < now) {
    if (flow.kind === "loopback") flow.session.close();
    pendingFlows.delete(pendingId);
    return { status: "error", message: "Login session expired. Start again." };
  }

  if (flow.kind === "loopback") {
    if (flow.outcome === "done") {
      pendingFlows.delete(pendingId);
      return { status: "done", provider: flow.provider };
    }
    if (flow.outcome === "error") {
      flow.session.close();
      pendingFlows.delete(pendingId);
      return { status: "error", message: flow.errorMessage ?? "Login failed" };
    }
    return { status: "pending" };
  }

  if (flow.kind === "code") {
    // Code flows complete via exchangeAuthorization, not polling.
    return { status: "pending" };
  }

  // device flow
  if (now < flow.nextPollAt) {
    return { status: "pending", interval: flow.interval };
  }
  const result = await pollDeviceAccessToken({ deviceCode: flow.deviceCode, fetchImpl });
  if (result.status === "pending") {
    const extra = result.slowDownBy ?? 0;
    flow.interval += extra;
    flow.nextPollAt = now + flow.interval * 1000;
    return { status: "pending", interval: flow.interval };
  }
  if (result.status === "error") {
    pendingFlows.delete(pendingId);
    return { status: "error", message: result.message };
  }
  await setCredential(env, result.credential);
  pendingFlows.delete(pendingId);
  return { status: "done", provider: flow.provider };
}

export type ExchangeResult =
  | { status: "done"; provider: string }
  | { status: "error"; message: string };

/** Complete a "code" flow (Anthropic) by exchanging the pasted `code#state`. */
export async function exchangeAuthorization({
  pendingId,
  code,
  env,
  fetchImpl,
  now,
}: {
  pendingId: string;
  code: string;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: number;
}): Promise<ExchangeResult> {
  const flow = pendingFlows.get(pendingId);
  if (!flow || flow.kind !== "code") {
    return { status: "error", message: "Login session not found or not a paste-code flow." };
  }
  if (flow.expiresAt < now) {
    pendingFlows.delete(pendingId);
    return { status: "error", message: "Login session expired. Start again." };
  }
  try {
    if (flow.provider !== ANTHROPIC_PROVIDER) {
      throw new Error(`Unsupported code-flow provider "${flow.provider}"`);
    }
    const credential = await exchangeAnthropicCode({
      pastedCode: code,
      verifier: flow.verifier,
      expectedState: flow.state,
      fetchImpl,
      now,
    });
    await setCredential(env, credential);
    pendingFlows.delete(pendingId);
    return { status: "done", provider: flow.provider };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function logoutProvider({
  provider,
  env,
}: {
  provider: string;
  env: Record<string, string | undefined>;
}): Promise<boolean> {
  return removeCredential(env, provider);
}

export async function isProviderLoggedIn(
  env: Record<string, string | undefined>,
  provider: string,
): Promise<boolean> {
  return (await getCredential(env, provider)) !== null;
}
