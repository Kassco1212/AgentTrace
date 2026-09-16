// Best-effort secret redaction, applied before text is persisted to SQLite.
//
// This is intentionally small: it catches common "KEY=value"-style secrets
// and Authorization headers. It is NOT a security boundary and must not be
// treated as a complete secrets scanner — see README "Privacy and security".

const REPLACEMENT = "[REDACTED]";

/** Env-var-style assignment names that look like secrets, e.g. API_KEY=...,
 * OPENAI_API_KEY=..., DB_PASSWORD=... Matches `<NAME>=<value>` where NAME
 * contains one of the sensitive keywords, on its own line-ish boundary. */
const KEY_VALUE_PATTERN =
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*\S+/gi;

/** `Authorization: Bearer <token>` style headers. */
const BEARER_PATTERN = /\b(Authorization\s*:\s*Bearer)\s+\S+/gi;

export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(KEY_VALUE_PATTERN, (_match, name: string) => `${name}=${REPLACEMENT}`)
    .replace(BEARER_PATTERN, (_match, prefix: string) => `${prefix} ${REPLACEMENT}`);
}
