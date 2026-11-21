// node-pty 1.1.0's macOS prebuilds lose spawn-helper's execute bit when npm
// installs them, and every session then fails with "posix_spawnp failed".
// Put it back after each install (the agent panel, src/agentPanel.ts).

import { chmodSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prebuilds = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", "node-pty", "prebuilds");
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
