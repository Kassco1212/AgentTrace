import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../src/security/redact";

describe("redactSecrets", () => {
  test("redacts common KEY=value secret patterns", () => {
    const input = [
      "API_KEY=abc123",
      "PASSWORD=hello",
      "TOKEN=my-secret-token",
      "OPENAI_API_KEY=sk-abcdef1234567890",
      "SECRET=shh",
      "AUTH_TOKEN=xyz",
      "ACCESS_TOKEN=zzz",
      "PRIVATE_KEY=-----BEGIN-----",
    ].join("\n");
    const result = redactSecrets(input);
    expect(result).toContain("API_KEY=[REDACTED]");
    expect(result).toContain("PASSWORD=[REDACTED]");
    expect(result).toContain("TOKEN=[REDACTED]");
    expect(result).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(result).toContain("SECRET=[REDACTED]");
    expect(result).toContain("AUTH_TOKEN=[REDACTED]");
    expect(result).toContain("ACCESS_TOKEN=[REDACTED]");
    expect(result).toContain("PRIVATE_KEY=[REDACTED]");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("my-secret-token");
  });

  test("redacts Authorization: Bearer headers", () => {
    const result = redactSecrets("Authorization: Bearer xyz-token-123");
    expect(result).toBe("Authorization: Bearer [REDACTED]");
  });

  test("leaves ordinary text untouched", () => {
    const input = "normal text\nfunction hello() { return 1; }";
    expect(redactSecrets(input)).toBe(input);
  });

  test("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  test("redacts secrets embedded within larger text", () => {
    const input = "Setting env var OPENAI_API_KEY=abc123 before running tests.";
    const result = redactSecrets(input);
    expect(result).toBe("Setting env var OPENAI_API_KEY=[REDACTED] before running tests.");
  });

  test("does not redact unrelated KEY=value pairs", () => {
    const input = "NODE_ENV=production\nPORT=3000";
    expect(redactSecrets(input)).toBe(input);
  });
});
