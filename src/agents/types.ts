// Adapter interface for wrapped coding-agent CLIs. Each supported agent
// (Claude Code, Codex, ...) implements this interface. All agent-specific
// invocation details (executable name, argument shape, prompt delivery
// mechanism) must stay inside the adapter — nothing outside src/agents/
// should branch on which agent is selected except the registry.

export interface AgentCommand {
  executable: string;
  args: string[];
}

export interface AgentAdapter {
  /** Stable identifier used on the command line, e.g. "claude". */
  name: string;
  /** Executable name looked up on PATH, e.g. "claude". */
  executable: string;
  /** True if the adapter's executable can be found on PATH. */
  isInstalled(): boolean;
  /** Builds the command + arguments used to invoke the agent with a prompt. */
  buildCommand(prompt: string): AgentCommand;
  /** Human-readable message shown when the executable is missing. */
  notInstalledMessage(): string;
}
