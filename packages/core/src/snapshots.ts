/**
 * snapshots.ts — The text of document versions that were read, so a changed
 * document can be compared with the version last read (docs/design/reads.md).
 *
 * One gzipped file per version, named by the SHA-1 of its bytes, in
 * <dataDir>/snapshots: versions shared by documents, or read twice, are kept
 * once. Documents over MAX_SNAPSHOT_BYTES get no snapshot. Snapshots no read
 * record or review round points at are deleted by `collect`.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// As the full-text search limit: specs are small, and a diff of more isn't read
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const NAME = /^([0-9a-f]{40})\.md\.gz$/;

export function sha1Of(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

export class SnapshotStore {
  readonly folder: string;

  constructor(dataDir: string) {
    this.folder = path.join(dataDir, "snapshots");
  }

  private file(sha1: string): string {
    return path.join(this.folder, `${sha1}.md.gz`);
  }

  /** Keep `bytes` as the version with their SHA-1, unless it's kept already or too large. */
  async save(bytes: Uint8Array): Promise<void> {
    if (bytes.length > MAX_SNAPSHOT_BYTES) return;
    const file = this.file(sha1Of(bytes));
    if (await fs.access(file).then(() => true, () => false)) return;
    await fs.mkdir(this.folder, { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, await gzipAsync(bytes));
    await fs.rename(tmp, file);
  }

  /** The text of the version with `sha1`, or null when there's no snapshot of it. */
  async read(sha1: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(sha1)) return null;
    try {
      return (await gunzipAsync(await fs.readFile(this.file(sha1)))).toString("utf8");
    } catch {
      return null;
    }
  }

  /** Delete the snapshots of versions not in `keep`; resolves how many went. */
  async collect(keep: ReadonlySet<string>): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.folder);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      const sha1 = NAME.exec(name)?.[1];
      // Other files (a write's leftover temp file) are left alone
      if (sha1 === undefined || keep.has(sha1)) continue;
      await fs.rm(path.join(this.folder, name), { force: true });
      removed++;
    }
    return removed;
  }
}
