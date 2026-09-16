// Adapter for the OpenAI Codex CLI.
//
// Assumption (documented per the spec's request to isolate flag details
// behind adapters, since CLI flags evolve): the installed `codex`
// executable accepts `exec <prompt>` to run non-interactively to completion.
// If Codex's CLI interface changes, only this file needs to change.
// Reference: https://developers.openai.com/

import type { AgentAdapter, AgentCommand } from "./types";

export const codexAdapter: AgentAdapter = {
  name: "codex",
  executable: "codex",

  isInstalled(): boolean {
    return Bun.which("codex") !== null;
  },

  buildCommand(prompt: string): AgentCommand {
    return {
      executable: "codex",
      args: ["exec", prompt],
    };
  },

  notInstalledMessage(): string {
    return "Codex CLI was not found in PATH.\nInstall or configure Codex and try again.";
  },
};
