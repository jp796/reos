import { test, expect, describe } from "bun:test";
import { buildNoteMessage } from "./TransactionNoteComms";

describe("note notification message", () => {
  const msg = buildNoteMessage({
    fromName: "Sheri Fluellen",
    property: "2315 Thomes Ave",
    body: "On it — calling the seller now.",
    dealUrl: "https://www.myrealestateos.com/transactions/tx1",
  });

  test("leads with who + which deal", () => {
    expect(msg.startsWith("Sheri Fluellen on 2315 Thomes Ave:")).toBe(true);
  });

  test("includes the body and the deal link", () => {
    expect(msg).toContain("On it — calling the seller now.");
    expect(msg).toContain("https://www.myrealestateos.com/transactions/tx1");
  });

  test("tells the teammate HOW to respond (reply-to-thread)", () => {
    expect(msg).toContain("Reply to this message");
  });
});
