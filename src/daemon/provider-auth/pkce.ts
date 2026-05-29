import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE (RFC 7636) helpers shared by the OAuth login flows (OpenAI loopback,
 * Anthropic paste-code). The verifier is a high-entropy random string; the
 * challenge is its base64url-encoded SHA-256 digest.
 */

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createState(): string {
  return base64url(randomBytes(16));
}

/** Decode a JWT payload without verifying the signature (we only read claims). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
