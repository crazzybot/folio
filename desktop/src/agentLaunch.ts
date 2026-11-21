/**
 * agentLaunch.ts — How the agent panel starts the user's coding agent.
 *
 * An app started from Finder or the Dock doesn't get the shell's PATH, and
 * agents installed with npm under nvm, asdf or Homebrew are only on that
 * PATH. So on macOS and Linux the agent runs through the user's login,
 * interactive shell, which reads their profile and rc files and then
 * replaces itself with the agent (`exec`): the session ends when the agent
 * does.
 */

export interface AgentLaunch {
  file: string;
  args: string[];
}

/** The agent's command line; FOLIO_AGENT_COMMAND overrides it while trying others out. */
export const DEFAULT_AGENT_COMMAND = "claude";

/** The Folio plugin's skill that waits for the notes the user sends (plugins/folio). */
export const REVIEW_LOOP_COMMAND = "/folio:review-loop";

/** Whether the command runs Claude Code, whose sessions the panel can name and resume. */
export function isClaudeCommand(command: string): boolean {
  const program = command.trim().split(/\s+/)[0] ?? "";
  return program.split(/[\\/]/).pop() === "claude";
}

/**
 * How a panel session starts. Claude Code sessions carry Folio's own id
 * (`--session-id`), so Start Review Loop can resume exactly this
 * conversation: `--continue` would take the folder's latest, which may be
 * another terminal's. "loop" starts a conversation with the review loop as
 * its first prompt; "resume-loop" goes on with one, into the loop. Both are
 * Claude Code's own command line with a prompt the user chose: Folio never
 * types into the session. Other agents run as they are.
 */
export function sessionCommand(command: string, id: string, mode: "new" | "loop" | "resume-loop"): string {
  if (!isClaudeCommand(command)) return command;
  if (mode === "new") return `${command} --session-id ${id}`;
  if (mode === "loop") return `${command} --session-id ${id} "${REVIEW_LOOP_COMMAND}"`;
  return `${command} --resume ${id} "${REVIEW_LOOP_COMMAND}"`;
}

export function agentLaunch(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): AgentLaunch {
  if (platform === "win32") {
    // cmd resolves claude.cmd / claude.exe from PATH, which Windows apps do get
    return { file: env["ComSpec"] ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  const shell = env["SHELL"] ?? (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  return { file: shell, args: ["-l", "-i", "-c", `exec ${command}`] };
}

/**
 * What a running Claude Code session hands its children. A Folio started from
 * one (`npm start`, the `folio` command, by an agent) would pass them on, and
 * the panel's session would take itself for that session's child. The user's
 * own settings (CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK, …) stay.
 */
const PARENT_SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];

/**
 * What an editor's terminal sets for the Claude Code there to connect to the
 * editor (VS Code's extension sets the port). A Folio started from that
 * terminal would pass them on, and the panel's session would show the
 * editor's open file as its context. The panel is a terminal of its own;
 * `/ide` in it still connects on purpose.
 */
const IDE_TERMINAL_VARIABLES = ["CLAUDE_CODE_SSE_PORT", "ENABLE_IDE_INTEGRATION"];

/**
 * The session's environment: the app's own, as a terminal would get it, plus
 * what the agent panel needs. FOLIO_AGENT_SESSION is passed down to the
 * Folio MCP server the agent starts, so it can say which panel it's in.
 */
export function agentEnv(env: NodeJS.ProcessEnv, session: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  // Electron's own: they would turn a node or electron the agent runs into something else
  delete result["ELECTRON_RUN_AS_NODE"];
  delete result["ELECTRON_NO_ATTACH_CONSOLE"];
  for (const name of [...PARENT_SESSION_VARIABLES, ...IDE_TERMINAL_VARIABLES]) delete result[name];
  return {
    ...result,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Folio",
    FOLIO_AGENT_SESSION: session,
  };
}
