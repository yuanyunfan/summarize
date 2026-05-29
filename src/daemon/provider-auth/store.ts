import { promises as fs } from "node:fs";
import path from "node:path";
import { DAEMON_CONFIG_DIR } from "../constants.js";

/**
 * Per-provider credentials obtained through third-party login (OAuth device
 * flow, PKCE, paste-code, …). Stored separately from `daemon.json` so that
 * adding/removing a login never touches the daemon's own bearer tokens.
 *
 * The store lives at `~/.summarize/auth.json` (mode 0600) and is re-read from
 * disk on every access so a freshly completed login takes effect without a
 * daemon restart.
 */
export const AUTH_STORE_FILENAME = "auth.json";
export const AUTH_STORE_VERSION = 1 as const;

export type OAuthProviderCredential = {
  type: "oauth";
  provider: string;
  /** Long-lived refresh token (for Copilot this doubles as the GitHub OAuth token). */
  refresh: string;
  /** Current access token. May be empty until first refresh/exchange. */
  access: string;
  /** Epoch milliseconds at which `access` expires. 0 = unknown / always refresh. */
  expires: number;
  accountId?: string;
};

export type ApiKeyProviderCredential = {
  type: "api";
  provider: string;
  key: string;
};

export type ProviderCredential = OAuthProviderCredential | ApiKeyProviderCredential;

export type AuthStore = {
  version: typeof AUTH_STORE_VERSION;
  credentials: Record<string, ProviderCredential>;
};

function resolveHomeDir(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) throw new Error("Missing HOME (required for provider auth store)");
  return home;
}

export function resolveAuthStorePath(env: Record<string, string | undefined>): string {
  return path.join(resolveHomeDir(env), DAEMON_CONFIG_DIR, AUTH_STORE_FILENAME);
}

/** Like {@link resolveAuthStorePath} but returns null instead of throwing when HOME is unset. */
function tryResolveAuthStorePath(env: Record<string, string | undefined>): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return null;
  return path.join(home, DAEMON_CONFIG_DIR, AUTH_STORE_FILENAME);
}

function isProviderCredential(value: unknown): value is ProviderCredential {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || record.provider.trim().length === 0) return false;
  if (record.type === "oauth") {
    return typeof record.refresh === "string";
  }
  if (record.type === "api") {
    return typeof record.key === "string" && record.key.trim().length > 0;
  }
  return false;
}

function normalizeStore(value: unknown): AuthStore {
  if (!value || typeof value !== "object") {
    return { version: AUTH_STORE_VERSION, credentials: {} };
  }
  const record = value as Record<string, unknown>;
  const credentials: Record<string, ProviderCredential> = {};
  if (record.credentials && typeof record.credentials === "object") {
    for (const [key, raw] of Object.entries(record.credentials as Record<string, unknown>)) {
      if (isProviderCredential(raw)) {
        credentials[key] = raw;
      }
    }
  }
  return { version: AUTH_STORE_VERSION, credentials };
}

/**
 * In-memory cache keyed by store path. Reads stat the file and invalidate the
 * cache when the file changes on disk, so concurrent logins (e.g. via the CLI)
 * are picked up without a restart while avoiding a read on every request.
 */
const cache = new Map<string, { mtimeMs: number; store: AuthStore }>();

export async function loadAuthStore(env: Record<string, string | undefined>): Promise<AuthStore> {
  const filePath = tryResolveAuthStorePath(env);
  if (!filePath) {
    return { version: AUTH_STORE_VERSION, credentials: {} };
  }
  let mtimeMs = 0;
  try {
    const stat = await fs.stat(filePath);
    mtimeMs = stat.mtimeMs;
  } catch {
    cache.delete(filePath);
    return { version: AUTH_STORE_VERSION, credentials: {} };
  }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.store;
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const store = normalizeStore(JSON.parse(raw));
    cache.set(filePath, { mtimeMs, store });
    return store;
  } catch {
    // Corrupt or unreadable file: fall back to empty store, don't cache.
    return { version: AUTH_STORE_VERSION, credentials: {} };
  }
}

async function writeAuthStore(
  env: Record<string, string | undefined>,
  store: AuthStore,
): Promise<void> {
  const filePath = resolveAuthStorePath(env);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(store, null, 2)}\n`;
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, body, { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Best-effort on platforms without chmod semantics (Windows).
  }
  cache.delete(filePath);
}

export async function getCredential(
  env: Record<string, string | undefined>,
  provider: string,
): Promise<ProviderCredential | null> {
  const store = await loadAuthStore(env);
  return store.credentials[provider] ?? null;
}

export async function setCredential(
  env: Record<string, string | undefined>,
  credential: ProviderCredential,
): Promise<void> {
  const store = await loadAuthStore(env);
  const next: AuthStore = {
    version: AUTH_STORE_VERSION,
    credentials: { ...store.credentials, [credential.provider]: credential },
  };
  await writeAuthStore(env, next);
}

export async function removeCredential(
  env: Record<string, string | undefined>,
  provider: string,
): Promise<boolean> {
  const store = await loadAuthStore(env);
  if (!(provider in store.credentials)) return false;
  const credentials = { ...store.credentials };
  delete credentials[provider];
  await writeAuthStore(env, { version: AUTH_STORE_VERSION, credentials });
  return true;
}

export async function listCredentials(
  env: Record<string, string | undefined>,
): Promise<ProviderCredential[]> {
  const store = await loadAuthStore(env);
  return Object.values(store.credentials);
}
