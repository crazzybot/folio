import { fileURLToPath } from "node:url";
import path from "node:path";

/** tests/fixtures at the repo root, shared with the backend's tests. */
export const FIXTURES = fileURLToPath(new URL("../../tests/fixtures", import.meta.url));
export const WORKSPACE = path.join(FIXTURES, "workspace");
export const SKIP = { skipDirs: new Set([".git", "node_modules"]) };
