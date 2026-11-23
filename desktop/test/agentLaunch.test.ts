import { describe, expect, it } from "vitest";
import { agentEnv, agentLaunch, CLAUDE_INSTALL_URL, isClaudeCommand, missingAgent } from "../src/agentLaunch";

describe("agentLaunch", () => {
  it("runs the agent through the user's login shell, replacing it", () => {
    expect(agentLaunch("claude", "darwin", { SHELL: "/opt/homebrew/bin/fish" })).toEqual({
      file: "/opt/homebrew/bin/fish",
      args: ["-l", "-i", "-c", "exec claude"],
    });
  });

  it("falls back to the platform's shell", () => {
    expect(agentLaunch("claude", "darwin", {}).file).toBe("/bin/zsh");
    expect(agentLaunch("claude", "linux", {}).file).toBe("/bin/sh");
  });

  it("uses cmd on Windows", () => {
    expect(agentLaunch("claude", "win32", { ComSpec: "C:\\Windows\\system32\\cmd.exe" })).toEqual({
      file: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", "claude"],
    });
  });
});

describe("agentEnv", () => {
  it("passes the app's environment without Electron's own, and names the session", () => {
    const env = agentEnv({ PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", EMPTY: undefined }, "s1");
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(env).not.toHaveProperty("EMPTY");
    expect(env["FOLIO_AGENT_SESSION"]).toBe("s1");
    expect(env["TERM"]).toBe("xterm-256color");
  });

  it("starts a session of its own, not the child of the Claude Code that started Folio", () => {
    const env = agentEnv({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "p", CLAUDE_CONFIG_DIR: "/c" }, "s1");
    expect(env).not.toHaveProperty("CLAUDECODE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/c");
  });

  it("doesn't connect to the editor whose terminal started Folio", () => {
    const env = agentEnv({ CLAUDE_CODE_SSE_PORT: "49996", ENABLE_IDE_INTEGRATION: "true" }, "s1");
    expect(env).not.toHaveProperty("CLAUDE_CODE_SSE_PORT");
    expect(env).not.toHaveProperty("ENABLE_IDE_INTEGRATION");
  });
});

describe("isClaudeCommand", () => {
  it("knows Claude Code by its program, wherever it's installed", () => {
    expect(isClaudeCommand("claude")).toBe(true);
    expect(isClaudeCommand("/opt/homebrew/bin/claude --verbose")).toBe(true);
    expect(isClaudeCommand("claude-dev")).toBe(false);
    expect(isClaudeCommand("codex")).toBe(false);
  });
});

describe("missingAgent", () => {
  it("points to Claude Code's install guide when the shell can't find claude", () => {
    expect(missingAgent("claude --continue", 127, "darwin")).toEqual({ program: "claude", installUrl: CLAUDE_INSTALL_URL });
    expect(missingAgent("claude", 9009, "win32")).toEqual({ program: "claude", installUrl: CLAUDE_INSTALL_URL });
  });

  it("names another agent's program, with no guide", () => {
    expect(missingAgent("codex", 127, "linux")).toEqual({ program: "codex", installUrl: null });
  });

  it("is null for any other ending", () => {
    expect(missingAgent("claude", 0, "darwin")).toBeNull();
    expect(missingAgent("claude", 1, "darwin")).toBeNull();
    // 127 means not found only from a POSIX shell
    expect(missingAgent("claude", 127, "win32")).toBeNull();
  });
});
