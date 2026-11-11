/**
 * images.ts — Serves images embedded by documents (`![](img/diagram.png)`)
 * from the workspace.
 *
 * Only image types are served, never from a skipped folder, and the
 * resolved file (symlinks included) must lie inside the workspace.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { IMAGE_TYPES } from "../../packages/core/src/imageTypes";

// Images are only ever displayed, never run: an SVG opened directly must not
// execute scripts (it would share the app's origin) or load anything.
const IMAGE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/** The file for workspace-relative `location`, or null if it isn't a servable image. */
async function findImage(
  workspace: string,
  location: string,
  skipDirs: ReadonlySet<string>,
): Promise<string | null> {
  const parts = location.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\\"))) return null;
  if (parts.slice(0, -1).some((part) => skipDirs.has(part))) return null;
  if (!(path.extname(location).toLowerCase() in IMAGE_TYPES)) return null;

  const filePath = path.join(workspace, ...parts);
  try {
    const [realWorkspace, target] = await Promise.all([fs.realpath(workspace), fs.realpath(filePath)]);
    if (!target.startsWith(realWorkspace + path.sep) || !(await fs.stat(target)).isFile()) return null;
    return target;
  } catch {
    return null;
  }
}

/** Respond to a request for the image at workspace-relative `location`. */
export async function serveImage(
  workspace: string | null,
  location: string,
  skipDirs: ReadonlySet<string>,
): Promise<Response> {
  const filePath = workspace === null ? null : await findImage(workspace, location, skipDirs);
  if (filePath === null) return new Response("Not found", { status: 404 });
  const body = await fs.readFile(filePath);
  return new Response(body, {
    headers: {
      "content-type": IMAGE_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-security-policy": IMAGE_CSP,
      "x-content-type-options": "nosniff",
    },
  });
}
