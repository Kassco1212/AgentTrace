// Single place where supported agent names are mapped to their adapters.
// This is the one file allowed to branch on agent name (per the spec: "The
// registry may contain branching once in one place").

import type { AgentAdapter } from "./types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";

const adapters: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export const SUPPORTED_AGENTS = Object.keys(adapters);

export function getAgentAdapter(name: string): AgentAdapter | null {
  return adapters[name] ?? null;
}
