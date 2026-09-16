// Validates adapter metadata and command construction only — never spawns
// a real Claude Code or Codex process (those may not be installed or
// authenticated in CI).

// @ts-ignore
import { describe, expect, test } from "bun:test";
import { claudeAdapter } from "../src/agents/claude";
import { codexAdapter } from "../src/agents/codex";
import { getAgentAdapter, SUPPORTED_AGENTS } from "../src/agents/registry";

describe("claude adapter", () => {
  test("has the expected name and executable", () => {
    expect(claudeAdapter.name).toBe("claude");
    expect(claudeAdapter.executable).toBe("claude");
  });

  test("buildCommand passes the prompt through without shell interpretation", () => {
    const prompt = "Fix the failing tests; don't touch package.json";
    const command = claudeAdapter.buildCommand(prompt);
    expect(command.executable).toBe("claude");
    expect(command.args).toContain(prompt);
    // The prompt must appear as a single argument, never concatenated into
    // a shell string.
    expect(Array.isArray(command.args)).toBe(true);
  });

  test("notInstalledMessage explains what to do", () => {
    expect(claudeAdapter.notInstalledMessage()).toContain("Claude Code CLI");
  });
});

describe("codex adapter", () => {
  test("has the expected name and executable", () => {
    expect(codexAdapter.name).toBe("codex");
    expect(codexAdapter.executable).toBe("codex");
  });

  test("buildCommand passes the prompt through without shell interpretation", () => {
    const prompt = "Refactor the database module";
    const command = codexAdapter.buildCommand(prompt);
    expect(command.executable).toBe("codex");
    expect(command.args).toContain(prompt);
  });

  test("notInstalledMessage explains what to do", () => {
    expect(codexAdapter.notInstalledMessage()).toContain("Codex CLI");
  });
});

describe("registry", () => {
  test("exposes exactly the MVP-supported agents", () => {
    expect(SUPPORTED_AGENTS.sort()).toEqual(["claude", "codex"]);
  });

  test("getAgentAdapter resolves known agents", () => {
    expect(getAgentAdapter("claude")).toBe(claudeAdapter);
    expect(getAgentAdapter("codex")).toBe(codexAdapter);
  });

  test("getAgentAdapter returns null for unknown agents", () => {
    expect(getAgentAdapter("gemini")).toBeNull();
  });
});
