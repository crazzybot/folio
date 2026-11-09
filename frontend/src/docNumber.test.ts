import { describe, expect, it } from "vitest";
import { documentNumber, titleWithoutNumber } from "./docNumber";

describe("documentNumber", () => {
  it("reads the leading number as written", () => {
    expect(documentNumber("0015-hmac-signatures.md")).toBe("0015");
    expect(documentNumber("01-intro.md")).toBe("01");
    expect(documentNumber("7_notes.markdown")).toBe("7");
    expect(documentNumber("12 Kickoff.md")).toBe("12");
    expect(documentNumber("404.md")).toBe("404");
    expect(documentNumber("0003.draft.md")).toBe("0003");
  });

  it("takes the number after a short prefix", () => {
    expect(documentNumber("ADR-015-hmac.md")).toBe("015");
    expect(documentNumber("adr_0002-delivery.md")).toBe("0002");
    expect(documentNumber("RFC 42.md")).toBe("42");
    expect(documentNumber("adr0007-queue.md")).toBe("0007");
  });

  it("leaves other names alone", () => {
    expect(documentNumber("README.md")).toBeNull();
    expect(documentNumber("2026-11-09-standup.md")).toBeNull();
    expect(documentNumber("v2-api.md")).toBeNull();
    expect(documentNumber("chapter10.md")).toBeNull(); // a 7-letter word isn't a prefix
    expect(documentNumber("3d-printing.md")).toBeNull(); // no separator after the number
    expect(documentNumber("api-v2.md")).toBeNull();
  });
});

describe("titleWithoutNumber", () => {
  it("drops the number the title starts with", () => {
    expect(titleWithoutNumber("ADR 0001: Postgres for the delivery queue", "0001")).toBe("Postgres for the delivery queue");
    expect(titleWithoutNumber("1. Record architecture decisions", "0001")).toBe("Record architecture decisions");
    expect(titleWithoutNumber("01 — MSP/HIBC Billing System Overview", "01")).toBe("MSP/HIBC Billing System Overview");
    expect(titleWithoutNumber("02 – Anatomy of a claim", "02")).toBe("Anatomy of a claim");
    expect(titleWithoutNumber("ADR-15 - HMAC signatures", "015")).toBe("HMAC signatures");
  });

  it("keeps titles that don't start with the same number", () => {
    expect(titleWithoutNumber("ADR 0002: At-least-once delivery", "0001")).toBe("ADR 0002: At-least-once delivery");
    expect(titleWithoutNumber("Postgres for the queue", "0001")).toBe("Postgres for the queue");
    expect(titleWithoutNumber("1.5 release notes", "1")).toBe("1.5 release notes");
    expect(titleWithoutNumber("404 Not found", "404")).toBe("404 Not found");
  });

  it("keeps a title that is only the number", () => {
    expect(titleWithoutNumber("ADR 0001:", "0001")).toBe("ADR 0001:");
    expect(titleWithoutNumber("0001", "0001")).toBe("0001");
  });
});
