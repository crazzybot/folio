/**
 * demo/reads.ts — The live demo's read records, kept in the browser like its
 * marks. The same rules as the desktop app's (packages/core/src/reads.ts):
 * the first visit records every document as read (the baseline), Mark as
 * read records the version shown, and Mark as unread goes back one read.
 *
 * Documents with a version read before the seeded review round (the
 * bundle's readVersions) start at that version instead, so they show as
 * changed since: the agent revised them.
 */

import type { DocumentRead, ReadVersion } from "../types";
import type { MarksStorage } from "./marks";

export const READS_STORAGE_KEY = "folio.demo.reads";
const VERSION = 1;

/** A version read before the seeded review round (demo-bundle.mjs). */
export interface ReadVersionSeed {
  text: string;
  /** When it was read. */
  at: string;
}

interface StoredRead {
  read: ReadVersion;
  previous?: ReadVersion;
  baseline: boolean;
}

/** What's kept under READS_STORAGE_KEY. */
interface Saved {
  version: number;
  documents: Record<string, StoredRead>;
}

/** The SHA-1 of `text` as UTF-8, in hex: what the desktop app records for a file's bytes. */
export async function sha1Of(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class DemoReads {
  private documents: Record<string, StoredRead> | null;
  private storage: MarksStorage | null;
  private hashes: Promise<Map<string, string>> | null = null;
  // The texts there are, by SHA-1: current versions and versions read before
  private texts: Promise<Map<string, string>> | null = null;

  /**
   * @param listed   the demo's documents, in list order
   * @param contents their Markdown, by document id
   * @param storage  where the records are kept; null keeps them in memory
   * @param readVersions versions read before the seeded round, by document id
   */
  constructor(
    private readonly listed: readonly { id: string; location: string }[],
    private readonly contents: Readonly<Record<string, string>>,
    storage: MarksStorage | null,
    private readonly readVersions: Readonly<Record<string, ReadVersionSeed>> = {},
  ) {
    this.storage = storage;
    this.documents = this.load();
  }

  private load(): Record<string, StoredRead> | null {
    try {
      const raw = this.storage?.getItem(READS_STORAGE_KEY);
      if (raw == null) return null;
      const saved = JSON.parse(raw) as Saved;
      return saved.version === VERSION && typeof saved.documents === "object" ? saved.documents : null;
    } catch {
      return null; // Unreadable or damaged: a new baseline
    }
  }

  private save(): void {
    try {
      const saved: Saved = { version: VERSION, documents: this.documents ?? {} };
      this.storage?.setItem(READS_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      this.storage = null; // From now on, in memory only
    }
  }

  /** The documents' hashes; the demo's documents never change, so once. */
  private current(): Promise<Map<string, string>> {
    this.hashes ??= Promise.all(
      this.listed.map(async (doc) => [doc.id, await sha1Of(this.contents[doc.id] ?? "")] as const),
    ).then((pairs) => new Map(pairs));
    return this.hashes;
  }

  /** Every text there is, by SHA-1, for snapshots. */
  private allTexts(): Promise<Map<string, string>> {
    this.texts ??= Promise.all(
      [...Object.values(this.contents), ...Object.values(this.readVersions).map((v) => v.text)].map(
        async (text) => [await sha1Of(text), text] as const,
      ),
    ).then((pairs) => new Map(pairs));
    return this.texts;
  }

  async list(): Promise<DocumentRead[]> {
    const hashes = await this.current();
    if (this.documents === null) {
      const at = new Date().toISOString();
      const documents: Record<string, StoredRead> = {};
      for (const [id, sha1] of hashes) {
        const before = this.readVersions[id];
        documents[id] =
          before === undefined
            ? { read: { sha1, at }, baseline: true }
            : { read: { sha1: await sha1Of(before.text), at: before.at }, baseline: false };
      }
      this.documents = documents;
      this.save();
    }
    const documents = this.documents;
    return this.listed.flatMap((doc) => {
      const sha1 = hashes.get(doc.id);
      if (sha1 === undefined) return [];
      const stored = documents[doc.id];
      return [{ docId: doc.id, sha1, read: stored?.read ?? null, baseline: stored?.baseline ?? false }];
    });
  }

  async mark(docId: string, sha1: string): Promise<void> {
    if ((await this.current()).get(docId) !== sha1) throw new Error("The document changed since it was shown");
    const documents = (this.documents ??= {});
    const old = documents[docId];
    const previous = old === undefined ? undefined : old.read.sha1 === sha1 ? old.previous : old.read;
    documents[docId] = { read: { sha1, at: new Date().toISOString() }, ...(previous ? { previous } : {}), baseline: false };
    this.save();
  }

  async unmark(docId: string): Promise<void> {
    const documents = (this.documents ??= {});
    const previous = documents[docId]?.previous;
    if (previous === undefined) delete documents[docId];
    else documents[docId] = { read: previous, baseline: false };
    this.save();
  }

  /**
   * The text of the version last read. The demo's documents never change,
   * so that's the current text when the record is of it, else none.
   */
  async snapshot(docId: string): Promise<string | null> {
    const read = this.documents?.[docId]?.read;
    return read === undefined ? null : ((await this.allTexts()).get(read.sha1) ?? null);
  }

  /** Back to the first visit's records: the next listing records them again. */
  reset(): void {
    this.documents = null;
    try {
      this.storage?.removeItem(READS_STORAGE_KEY);
    } catch {
      this.storage = null;
    }
  }

  async markFolder(folder: string): Promise<void> {
    const hashes = await this.current();
    for (const doc of this.listed) {
      const sha1 = hashes.get(doc.id);
      if (sha1 !== undefined && (folder === "" || doc.location.startsWith(`${folder}/`))) await this.mark(doc.id, sha1);
    }
  }
}
