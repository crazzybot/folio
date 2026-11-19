import { describe, expect, it } from "vitest";
import {
  KNOWN_STATUSES,
  isRetired,
  normaliseStatus,
  requestDone,
  statusChoices,
  statusKind,
  statusNew,
  statusText,
  supersedingDocument,
} from "./status";
import type { DocumentMeta, Metadata } from "./types";

const meta = (status: string | null, statusDetail: string | null = null): Metadata => ({
  status,
  statusDetail,
  date: null,
  people: [],
  tags: [],
  statusLine: null,
});

const doc = (location: string, m?: Metadata): DocumentMeta => ({
  id: location,
  filename: location.split("/").pop() ?? location,
  location,
  title: location,
  created: "",
  headings: [],
  ...(m === undefined ? {} : { meta: m }),
});

describe("statusKind and isRetired", () => {
  it("knows the lifecycle's statuses and their other words", () => {
    expect(statusKind("accepted")).toBe("accepted");
    expect(statusKind("in-progress")).toBe("in-progress");
    expect(statusKind("implemented")).toBe("implemented");
    expect(statusKind("superseded")).toBe("superseded");
    expect(["wip", "approved", "partial", "done", "on-hold", "withdrawn"].map(statusKind)).toEqual([
      "draft",
      "accepted",
      "in-progress",
      "implemented",
      "deferred",
      "rejected",
    ]);
    expect(statusKind("phases")).toBe("other");
    expect(statusKind("constructor")).toBe("other");
  });

  it("dims what no longer applies", () => {
    expect(["proposed", "accepted", "implemented", "draft", "deferred"].map(isRetired)).toEqual([false, false, false, false, false]);
    expect(["rejected", "deprecated", "superseded", "withdrawn"].map(isRetired)).toEqual([true, true, true, true]);
  });
});

describe("normaliseStatus and requestDone", () => {
  it("reads a status as the scanners do", () => {
    expect(["Accepted", " accepted. ", "**Approved**", "superseded by ADR-5", "In progress: phase 2", ""].map(normaliseStatus)).toEqual([
      "accepted",
      "accepted",
      "approved",
      "superseded",
      "in-progress",
      "",
    ]);
  });

  it("is done when the document has the requested status", () => {
    expect(requestDone("accepted", "Accepted")).toBe(true);
    expect(requestDone("proposed", "accepted")).toBe(false);
    expect(requestDone(null, "accepted")).toBe(false);
    expect(requestDone("accepted", null)).toBe(false);
  });
});

describe("statusNew", () => {
  const note = (statusSeen?: string) => ({
    text: null,
    requestedStatus: "Accepted",
    created: "2026-11-01T00:00:00Z",
    updated: "2026-11-01T00:00:00Z",
    ...(statusSeen === undefined ? {} : { statusSeen }),
  });

  it("is new once the document has the requested status, until the note is opened with it", () => {
    expect(statusNew("proposed", note())).toBe(false);
    expect(statusNew("accepted", note())).toBe(true);
    expect(statusNew("accepted", note("proposed"))).toBe(true);
    expect(statusNew("accepted", note("accepted"))).toBe(false);
    expect(statusNew("accepted", undefined)).toBe(false);
  });
});

describe("statusChoices", () => {
  it("offers the known statuses, then the workspace's others sorted, once each", () => {
    expect(statusChoices(["wip", "accepted", "awaiting", "wip"], null)).toEqual([...KNOWN_STATUSES, "awaiting", "wip"]);
  });

  it("keeps the document's own status, known or not", () => {
    expect(statusChoices([], "accepted")).toEqual([...KNOWN_STATUSES]);
    expect(statusChoices(["wip"], "awaiting")).toEqual([...KNOWN_STATUSES, "awaiting", "wip"]);
  });
});

describe("statusText", () => {
  it("reads the detail as plain text, else the word, capitalised", () => {
    expect(statusText(meta("accepted"))).toBe("Accepted");
    expect(statusText(meta("superseded", "superseded by ADR-0005"))).toBe("Superseded by ADR-0005");
    expect(statusText(meta("superseded", "Superseded by [4. Kafka](0004-kafka.md)"))).toBe("Superseded by 4. Kafka");
  });
});

describe("supersedingDocument", () => {
  const kafka = doc("docs/adr/0004-kafka.md");
  const queue = doc("docs/adr/0005-queue.md");
  const elsewhere = doc("specs/0005-other.md");
  const all = [kafka, queue, elsewhere];

  it("follows a Markdown link, relative to the document", () => {
    const old = doc("docs/adr/0001-old.md", meta("superseded", "Superseded by [4. Kafka](0004-kafka.md)"));
    expect(supersedingDocument(old, [old, ...all])).toBe(kafka);
    const up = doc("docs/adr/0001-old.md", meta("superseded", "superseded by [spec](../../specs/0005-other.md#top)"));
    expect(supersedingDocument(up, [up, ...all])).toBe(elsewhere);
  });

  it("finds the numbered document in the same folder", () => {
    const old = doc("docs/adr/0001-old.md", meta("superseded", "superseded by ADR-5"));
    expect(supersedingDocument(old, [old, ...all])).toBe(queue);
  });

  it("finds nothing otherwise", () => {
    const by = (detail: string | null, status = "superseded") => doc("docs/adr/0001-old.md", meta(status, detail));
    expect(supersedingDocument(by(null), all)).toBeNull();
    expect(supersedingDocument(by("superseded by the new design"), all)).toBeNull();
    expect(supersedingDocument(by("superseded by ADR-0009"), all)).toBeNull();
    expect(supersedingDocument(by("deprecated in favour of ADR-0005", "deprecated"), all)).toBeNull();
    expect(supersedingDocument(by("superseded by [x](https://example.com/0005)"), all)).toBeNull();
  });
});
