import { describe, expect, it } from "vitest";
import { isRetired, statusKind, statusText, supersedingDocument } from "./status";
import type { DocumentMeta, Metadata } from "./types";

const meta = (status: string | null, statusDetail: string | null = null): Metadata => ({
  status,
  statusDetail,
  date: null,
  people: [],
  tags: [],
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
  it("knows MADR's statuses", () => {
    expect(statusKind("accepted")).toBe("accepted");
    expect(statusKind("superseded")).toBe("superseded");
    expect(statusKind("draft")).toBe("other");
  });

  it("dims what no longer applies", () => {
    expect(["proposed", "accepted", "draft"].map(isRetired)).toEqual([false, false, false]);
    expect(["rejected", "deprecated", "superseded"].map(isRetired)).toEqual([true, true, true]);
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
