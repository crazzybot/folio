import { describe, expect, it } from "vitest";
import { agentEnv, agentLaunch } from "../src/agentLaunch";

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
});
