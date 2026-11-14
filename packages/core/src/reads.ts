/**
 * reads.ts — Which version of each document the user last read, so the
 * list can show what's new or changed since (docs/design/reads.md).
 *
 * Kept beside the marks, in <dataDir>/reads/<record id>.json, one file per
 * document, with the same record id as its marks (marks.ts). A record holds
 * the SHA-1 of the bytes that were read and when, the read before it, so
 * Mark as unread can go back one step, and a few reads before that. Records
 * are written atomically and changes run one at a time, as for marks.
 *
 * A document whose bytes go back to a version read before (a git checkout
 * of another branch, an edit undone) is read: listing it makes that version
 * the last read again, so switching branches doesn't mark documents unread.
 *
 * The first time a workspace is listed, each of its documents without a
 * record is recorded as read at its current version (a baseline), so the
 * list isn't all "new" on day one. The workspaces seen are kept in
 * reads/workspaces.json, so this happens once per workspace.
 *
 * Each version recorded as read is also kept as a snapshot (snapshots.ts),
 * so a changed document can be compared with it.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MarkError, realPath, recordId } from "./marks";
import { sha1Of, SnapshotStore } from "./snapshots";

const VERSION = 1;
const SHA1 = /^[0-9a-f]{40}$/;
// Versions remembered per document: the last read, the one before, and
// enough earlier ones for a few branches. Each keeps a snapshot.
export const MAX_READ_VERSIONS = 10;

/** A version that was read: the SHA-1 of its bytes, and when. */
export interface ReadVersion {
  sha1: string;
  /** ISO-8601. */
  at: string;
}

/** A version read before `previous`; `baseline` when recorded at the baseline, not actually read. */
interface EarlierVersion extends ReadVersion {
  baseline?: true;
}

export interface ReadRecord {
  version: number;
  path: string;
  read: ReadVersion;
  /** The read before this one, for Mark as unread; absent when there was none. */
  previous?: EarlierVersion;
  /** Reads before `previous`, most recent first, so a version read again counts as read. */
  earlier?: EarlierVersion[];
  /** Recorded when Folio first saw the workspace, not actually read. */
  baseline: boolean;
}

/** A listed document's current version and what was last read of it. */
export interface DocumentRead {
  docId: string;
  /** The SHA-1 of its bytes now. */
  sha1: string;
  /** Null when it was never read: it appeared after the baseline. */
  read: ReadVersion | null;
  baseline: boolean;
}

/** A listed document (a workspace scan's). */
interface ListedDocument {
  id: string;
  location: string;
}

// ---------------------------------------------------------------------------
// Hashing, cached by modification time and size
// ---------------------------------------------------------------------------

const hashes = new Map<string, { mtimeMs: number; size: number; sha1: string }>();

/** The SHA-1 of `file`'s bytes; null when it can't be read. */
export async function hashFile(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    const cached = hashes.get(file);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.sha1;
    const sha1 = createHash("sha1").update(await fs.readFile(file)).digest("hex");
    hashes.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, sha1 });
    return sha1;
  } catch {
    return null;
  }
}

function isVersion(value: unknown): value is EarlierVersion {
  const v = value as EarlierVersion | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.sha1 === "string" &&
    typeof v.at === "string" &&
    (v.baseline === undefined || v.baseline === true)
  );
}

function isReadRecord(value: unknown): value is ReadRecord {
  const r = value as ReadRecord | null;
  return (
    typeof r === "object" &&
    r !== null &&
    r.version === VERSION &&
    typeof r.path === "string" &&
    isVersion(r.read) &&
    (r.previous === undefined || isVersion(r.previous)) &&
    (r.earlier === undefined || (Array.isArray(r.earlier) && r.earlier.every(isVersion))) &&
    typeof r.baseline === "boolean"
  );
}

/** The versions a record holds, the last read first; the baseline's is flagged wherever it is. */
function versionsOf(record: ReadRecord): EarlierVersion[] {
  const read: EarlierVersion = record.baseline ? { ...record.read, baseline: true } : record.read;
  return [read, ...(record.previous ? [record.previous] : []), ...(record.earlier ?? [])];
}

/** A record of `versions`, the last read first: each version once, at most MAX_READ_VERSIONS. */
function recordOf(file: string, versions: readonly EarlierVersion[]): ReadRecord | null {
  const seen = new Set<string>();
  const kept = versions.filter((v) => !seen.has(v.sha1) && seen.add(v.sha1)).slice(0, MAX_READ_VERSIONS);
  const [first, previous, ...earlier] = kept;
  if (first === undefined) return null;
  const { baseline, ...read } = first;
  return {
    version: VERSION,
    path: file,
    read,
    ...(previous ? { previous } : {}),
    ...(earlier.length > 0 ? { earlier } : {}),
    baseline: baseline === true,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ReadsStore {
  readonly folder: string;
  readonly snapshots: SnapshotStore;
  // Changes are read–modify–write of one file: run them one at a time
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.folder = path.join(dataDir, "reads");
    this.snapshots = new SnapshotStore(dataDir);
  }

  private file(id: string): string {
    return path.join(this.folder, `${id}.json`);
  }

  private get workspacesFile(): string {
    return path.join(this.folder, "workspaces.json");
  }

  /** The workspaces listed before (real paths), with when they were first seen. */
  private async seenWorkspaces(): Promise<Record<string, string>> {
    try {
      const seen: unknown = JSON.parse(await fs.readFile(this.workspacesFile, "utf8"));
      return typeof seen === "object" && seen !== null && !Array.isArray(seen) ? (seen as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private serially<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queue.then(change);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** The record, null if there's none or it's unreadable (a damaged one is replaced by the next read). */
  private async read(id: string): Promise<ReadRecord | null> {
    try {
      const record: unknown = JSON.parse(await fs.readFile(this.file(id), "utf8"));
      return isReadRecord(record) ? record : null;
    } catch {
      return null;
    }
  }

  /** Save atomically: a temp file, then rename. */
  private async write(id: string, record: ReadRecord): Promise<void> {
    await this.writeJson(this.file(id), record);
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(this.folder, { recursive: true });
    const tmp = `${file.slice(0, -".json".length)}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  }

  /**
   * Each of `documents` (a scan of `workspace`) with its current SHA-1 and
   * last read version. The first listing of a workspace records the
   * baseline. Documents that can't be read are left out.
   */
  list(workspace: string, documents: readonly ListedDocument[]): Promise<DocumentRead[]> {
    return this.serially(async () => {
      const listed: (DocumentRead & { file: string })[] = [];
      for (const doc of documents) {
        const file = path.join(workspace, ...doc.location.split("/"));
        const sha1 = await hashFile(file);
        if (sha1 === null) continue;
        let record = await this.read(recordId(file));
        // Back at a version read before: it's the last read again
        const before = record === null || record.read.sha1 === sha1 ? undefined : versionsOf(record).find((v) => v.sha1 === sha1);
        if (record !== null && before !== undefined) {
          record = recordOf(record.path, [before, ...versionsOf(record)]);
          if (record !== null) await this.write(recordId(file), record);
        }
        listed.push({ docId: doc.id, sha1, read: record?.read ?? null, baseline: record?.baseline ?? false, file });
      }
      const seen = await this.seenWorkspaces();
      const root = realPath(workspace);
      if (seen[root] === undefined) {
        const at = new Date().toISOString();
        for (const doc of listed.filter((d) => d.read === null)) {
          doc.read = { sha1: doc.sha1, at };
          doc.baseline = true;
          await this.write(recordId(doc.file), { version: VERSION, path: realPath(doc.file), read: doc.read, baseline: true });
          await this.keepSnapshot(doc.file, doc.sha1);
        }
        await this.writeJson(this.workspacesFile, { ...seen, [root]: at });
      }
      return listed.map(({ file: _file, ...doc }) => doc);
    });
  }

  /**
   * Record that the version of `file` with `sha1` was read. Refused (409)
   * when the file has changed since: the version read isn't the one on disk.
   */
  async mark(file: string, sha1: unknown): Promise<ReadVersion> {
    if (typeof sha1 !== "string" || !SHA1.test(sha1)) throw new MarkError(400, "sha1 must be a SHA-1 in hex");
    return this.serially(async () => {
      const bytes = await fs.readFile(file).catch(() => null);
      if (bytes === null || sha1Of(bytes) !== sha1) throw new MarkError(409, "The document changed since it was shown");
      await this.snapshots.save(bytes);
      const id = recordId(file);
      const old = await this.read(id);
      const read = { sha1, at: new Date().toISOString() };
      // Reading the same version again keeps the step back as it was
      const older = old === null ? [] : old.read.sha1 === sha1 ? versionsOf(old).slice(1) : versionsOf(old);
      const record = recordOf(realPath(file), [read, ...older.filter((v) => v.sha1 !== sha1)]);
      if (record !== null) await this.write(id, record);
      return read;
    });
  }

  /** Snapshot `file` when its bytes are still the version `sha1`. */
  private async keepSnapshot(file: string, sha1: string): Promise<void> {
    const bytes = await fs.readFile(file).catch(() => null);
    if (bytes !== null && sha1Of(bytes) === sha1) await this.snapshots.save(bytes).catch(() => {});
  }

  /** The text of the version of `file` last read, or null without a record or a snapshot of it. */
  async lastRead(file: string): Promise<string | null> {
    const record = await this.read(recordId(file));
    return record === null ? null : this.snapshots.read(record.read.sha1);
  }

  /** Every version a record points at (last read and the ones before), for collecting snapshots. */
  async versions(): Promise<Set<string>> {
    const versions = new Set<string>();
    let names: string[];
    try {
      names = (await fs.readdir(this.folder)).filter((name) => name.endsWith(".json") && name !== "workspaces.json");
    } catch {
      return versions;
    }
    for (const name of names) {
      const record = await this.read(name.slice(0, -".json".length));
      if (record === null) continue;
      for (const version of versionsOf(record)) versions.add(version.sha1);
    }
    return versions;
  }

  /** Mark each of `files` read at its current version. */
  async markAll(files: readonly string[]): Promise<void> {
    for (const file of files) {
      const sha1 = await hashFile(file);
      if (sha1 !== null) await this.mark(file, sha1).catch(() => {});
    }
  }

  /**
   * Go back one read: the previous version read becomes the last one, so the
   * document shows as changed again. The version unmarked is forgotten, so
   * listing doesn't count it as read again. With none before it, the record
   * goes and the document shows as new.
   */
  unmark(file: string): Promise<void> {
    return this.serially(async () => {
      const id = recordId(file);
      const old = await this.read(id);
      const record = old === null ? null : recordOf(old.path, versionsOf(old).slice(1));
      if (record === null) await fs.rm(this.file(id), { force: true });
      else await this.write(id, record);
    });
  }
}
