// Adapter for the Claude Code CLI.
//
// Assumption (documented per the spec's request to isolate flag details
// behind adapters, since CLI flags evolve): the installed `claude`
// executable accepts a prompt as a positional argument and runs
// non-interactively to completion. If Claude Code's CLI interface changes,
// only this file needs to change.
// Reference: https://docs.anthropic.com/en/docs/claude-code

import type { AgentAdapter, AgentCommand } from "./types";

export const claudeAdapter: AgentAdapter = {
  name: "claude",
  executable: "claude",

  isInstalled(): boolean {
    return Bun.which("claude") !== null;
  },

  buildCommand(prompt: string): AgentCommand {
    return {
      executable: "claude",
      args: ["--print", prompt],
    };
  },

  notInstalledMessage(): string {
    return "Claude Code CLI was not found in PATH.\nInstall or configure Claude Code and try again.";
  },
};
