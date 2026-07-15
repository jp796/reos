import { test, expect, describe } from "bun:test";
import { classifyDocument, parseIngestSignal } from "./DocAttachmentAudit";

const doc = (over: Partial<Parameters<typeof classifyDocument>[0]> = {}) => ({
  fileName: "PurchaseAgreement.pdf",
  mimeType: "application/pdf",
  source: "gmail_attachment",
  uploadOrigin: "ingest:address",
  ...over,
});

describe("parseIngestSignal", () => {
  test("extracts the signal", () => {
    expect(parseIngestSignal("ingest:sender_email")).toBe("sender_email");
    expect(parseIngestSignal("manual")).toBeNull();
    expect(parseIngestSignal(null)).toBeNull();
  });
});

describe("trusted docs → LIKELY-CORRECT", () => {
  test("manual upload (any type)", () => {
    expect(classifyDocument(doc({ source: "upload", uploadOrigin: "manual" })).verdict).toBe("LIKELY-CORRECT");
  });
  test("FUB attachment", () => {
    expect(classifyDocument(doc({ source: "fub_attachment", uploadOrigin: null })).verdict).toBe("LIKELY-CORRECT");
  });
  test("gmail attach matched on address", () => {
    expect(classifyDocument(doc({ uploadOrigin: "ingest:address" })).verdict).toBe("LIKELY-CORRECT");
  });
  test("gmail attach from this deal's principal", () => {
    expect(classifyDocument(doc({ uploadOrigin: "ingest:sender_principal" })).verdict).toBe("LIKELY-CORRECT");
  });
});

describe("the mess → LIKELY-MIS-ATTACHED", () => {
  test("old sender-only rule", () => {
    const r = classifyDocument(doc({ uploadOrigin: "ingest:sender_email" }));
    expect(r.verdict).toBe("LIKELY-MIS-ATTACHED");
    expect(r.reasons[0]).toContain("sender-only");
  });
  test("shared vendor on sender alone", () => {
    expect(classifyDocument(doc({ uploadOrigin: "ingest:sender_vendor" })).verdict).toBe("LIKELY-MIS-ATTACHED");
  });
  test("signature-image junk (image mime)", () => {
    expect(classifyDocument(doc({ fileName: "logo.png", mimeType: "image/png", uploadOrigin: "ingest:sender_email" })).verdict)
      .toBe("LIKELY-MIS-ATTACHED");
  });
  test("inline image by filename (image003.jpg)", () => {
    expect(classifyDocument(doc({ fileName: "image003.jpg", mimeType: "application/octet-stream", uploadOrigin: "ingest:address" })).verdict)
      .toBe("LIKELY-MIS-ATTACHED");
  });
  test("non-document extension (.ics calendar)", () => {
    expect(classifyDocument(doc({ fileName: "invite.ics", mimeType: "text/calendar" })).verdict)
      .toBe("LIKELY-MIS-ATTACHED");
  });
});

describe("filename-vs-deal-address cross-check", () => {
  const addr = "3216 Land Ct, Cheyenne, WY";
  test("sender-only doc whose filename names THIS property → softened to REVIEW (keep-leaning)", () => {
    const r = classifyDocument(
      doc({ fileName: "Roof Cert - 3216 Land Ct.pdf", uploadOrigin: "ingest:sender_email" }),
      { dealAddress: addr },
    );
    expect(r.verdict).toBe("REVIEW");
    expect(r.reasons[0]).toContain("references this property");
  });
  test("sender-only doc naming a DIFFERENT property → stays LIKELY-MIS-ATTACHED", () => {
    const r = classifyDocument(
      doc({ fileName: "1208 Windmill - Vacant Policy.pdf", uploadOrigin: "ingest:sender_email" }),
      { dealAddress: addr },
    );
    expect(r.verdict).toBe("LIKELY-MIS-ATTACHED");
  });
  test("generic-named sender-only doc → stays LIKELY-MIS-ATTACHED", () => {
    expect(classifyDocument(doc({ fileName: "Amend.pdf", uploadOrigin: "ingest:sender_email" }), { dealAddress: addr }).verdict)
      .toBe("LIKELY-MIS-ATTACHED");
  });
  test("junk image is never rescued by an address in the name", () => {
    expect(
      classifyDocument(doc({ fileName: "3216-banner.png", mimeType: "image/png", uploadOrigin: "ingest:sender_email" }), { dealAddress: addr }).verdict,
    ).toBe("LIKELY-MIS-ATTACHED");
  });
});

describe("uncertain → REVIEW", () => {
  test("weak party-name match", () => {
    expect(classifyDocument(doc({ uploadOrigin: "ingest:party_name" })).verdict).toBe("REVIEW");
  });
  test("gmail attach with no recorded signal", () => {
    expect(classifyDocument(doc({ uploadOrigin: null })).verdict).toBe("REVIEW");
  });
  test("a real PDF from a manual upload is never flagged as junk", () => {
    // guards against over-flagging deliberate uploads
    expect(classifyDocument(doc({ source: "upload", fileName: "scan.png", mimeType: "image/png" })).verdict)
      .toBe("LIKELY-CORRECT");
  });
});
