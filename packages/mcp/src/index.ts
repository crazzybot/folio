/**
 * index.ts — `folio-mcp`: Folio's MCP server over stdio, started by the
 * agent (Claude Code, Cursor, Codex…) in the project it works on.
 *
 *   folio-mcp [--root <folder>] [--data-dir <folder>]
 *
 * The root defaults to the working directory the agent starts it in; marks
 * are read and written in ~/.folio, as the app does, whether or not the app
 * is running.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { parseArgs } from "node:util";
import { defaultDataDir } from "../../core/src/marks";
import { Folio } from "./folio";
import { createServer } from "./server";

const USAGE = `Usage: folio-mcp [--root <folder>] [--data-dir <folder>]

Folio's MCP server: gives a coding agent the review notes you left in Folio
on the Markdown documents under the root, and keeps its replies.

  --root <folder>      The documents' folder (default: the working directory)
  --data-dir <folder>  Where Folio keeps marks (default: ~/.folio)
`;

function main(): void {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        root: { type: "string" },
        "data-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  const folio = new Folio({
    root: values.root ?? process.cwd(),
    dataDir: values["data-dir"] ?? defaultDataDir(),
  });
  // The presence file says a session is waiting: it goes with the session.
  // Signals otherwise end the process without the exit event
  process.on("exit", () => folio.leave());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => process.exit(0));
  // One server for the connection: the agent keeps it for its session
  serveStdio(() => createServer(folio));
}

main();
