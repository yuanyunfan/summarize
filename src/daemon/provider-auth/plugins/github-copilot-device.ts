import type { OAuthProviderCredential } from "../store.js";

/**
 * GitHub Copilot login uses GitHub's OAuth **device flow** (RFC 8628), the same
 * client id the official Copilot editors use. The token we obtain from GitHub is
 * a long-lived OAuth token; it is NOT the token the Copilot API accepts. At
 * request time we exchange it for a short-lived Copilot bearer via
 * `copilot_internal/v2/token` (see `copilot-token.ts`).
 */
export const GITHUB_COPILOT_PROVIDER = "github-copilot-oauth";

const GITHUB_COPILOT_CLIENT_ID = "Ov23li8tweQw6odWQebz";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_OAUTH_SCOPE = "read:user";

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Server-suggested polling interval in seconds. */
  interval: number;
  /** Epoch milliseconds at which the device code expires. */
  expiresAt: number;
};

type DeviceCodeResponse = {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  expires_in?: unknown;
  interval?: unknown;
};

type AccessTokenResponse = {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Step 1: request a device + user code. The caller shows `userCode` to the user
 * and opens `verificationUri`, then polls {@link pollDeviceAccessToken}.
 */
export async function requestDeviceAuthorization({
  fetchImpl,
  now,
}: {
  fetchImpl: typeof fetch;
  now: number;
}): Promise<DeviceAuthorization> {
  const response = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      "User-Agent": "summarize",
    },
    body: JSON.stringify({ client_id: GITHUB_COPILOT_CLIENT_ID, scope: GITHUB_OAUTH_SCOPE }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub device code request failed (${response.status}): ${bodyText}`);
  }
  const data = JSON.parse(bodyText) as DeviceCodeResponse;
  const deviceCode = asString(data.device_code);
  const userCode = asString(data.user_code);
  const verificationUri = asString(data.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("GitHub device code response missing required fields");
  }
  const interval = asNumber(data.interval, 5);
  const expiresIn = asNumber(data.expires_in, 900);
  return {
    deviceCode,
    userCode,
    verificationUri,
    interval,
    expiresAt: now + expiresIn * 1000,
  };
}

export type PollResult =
  | { status: "pending"; slowDownBy?: number }
  | { status: "done"; credential: OAuthProviderCredential }
  | { status: "error"; message: string };

/**
 * Step 2: poll for the access token. Returns `pending` (with an optional
 * back-off increment for `slow_down`) until the user authorizes, then `done`
 * with a persistable credential, or `error` on a terminal failure.
 */
export async function pollDeviceAccessToken({
  deviceCode,
  fetchImpl,
}: {
  deviceCode: string;
  fetchImpl: typeof fetch;
}): Promise<PollResult> {
  const response = await fetchImpl(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      "User-Agent": "summarize",
    },
    body: JSON.stringify({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    return { status: "error", message: `GitHub token poll failed (${response.status})` };
  }
  const data = JSON.parse(bodyText) as AccessTokenResponse;
  const accessToken = asString(data.access_token);
  if (accessToken) {
    return {
      status: "done",
      credential: {
        type: "oauth",
        provider: GITHUB_COPILOT_PROVIDER,
        refresh: accessToken,
        access: accessToken,
        expires: 0,
      },
    };
  }
  const error = asString(data.error);
  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") return { status: "pending", slowDownBy: 5 };
  const description = asString(data.error_description) ?? error ?? "unknown error";
  return { status: "error", message: `GitHub authorization failed: ${description}` };
}
