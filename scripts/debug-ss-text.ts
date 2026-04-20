/**
 * Dump the extracted text of one Settlement Statement attachment so
 * we can see what patterns actually exist in the user's PDFs.
 *
 * Run: node --env-file=.env --import tsx scripts/debug-ss-text.ts <pendingRowId>
 */

import { PrismaClient } from "@prisma/client";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "../src/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "../src/services/integrations/GmailService";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";
import { EncryptionService } from "../src/lib/encryption";

const PATTERNS: RegExp[] = [
  /settlement[_\s-]*statement/i,
  /closing[_\s-]*disclosure/i,
  /alta.*settlement/i,
  /\bcd\b.*\.pdf$/i,
  /hud[-\s]?1/i,
  /final.*cd/i,
  /final.*settlement/i,
];

async function main() {
  const rowId = process.argv[2];
  const db = new PrismaClient();
  const enc = new EncryptionService();

  const row = rowId
    ? await db.pendingClosingDateUpdate.findUnique({ where: { id: rowId } })
    : await db.pendingClosingDateUpdate.findFirst({
        where: { status: "pending" },
        orderBy: { detectedAt: "desc" },
      });
  if (!row) throw new Error("no pending row found");
  console.log(
    `Row: threadId=${row.threadId} attachmentId=${row.attachmentId?.slice(0, 24)}… side=${row.side}`,
  );

  const acct = await db.account.findFirst({
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!acct?.googleOauthTokensEncrypted) throw new Error("Google not connected");

  const oauth = new GoogleOAuthService(
    {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
      scopes: DEFAULT_SCOPES,
    },
    db,
    enc,
  );
  const auth = await oauth.createAuthenticatedClient(acct.id);
  const gmail = new GmailService(
    acct.id,
    auth,
    {
      labelPrefix: "REOS/",
      autoOrganizeThreads: false,
      extractAttachments: true,
      batchSize: 10,
      rateLimitDelayMs: 100,
    },
    db,
    new EmailTransactionMatchingService(),
  );

  if (!row.threadId) throw new Error("row has no threadId");
  const thread = await gmail.getThread(row.threadId);
  if (!thread?.messages) throw new Error("thread not found");

  let found: { messageId: string; attachmentId: string; filename: string } | null = null;
  for (const m of thread.messages) {
    if (!m.id) continue;
    const atts = await gmail.getMessageAttachments(m.id);
    for (const a of atts) {
      if (PATTERNS.some((p) => p.test(a.filename))) {
        found = { messageId: m.id, attachmentId: a.attachmentId, filename: a.filename };
        break;
      }
    }
    if (found) break;
  }
  if (!found) throw new Error("no SS attachment in thread");
  console.log(`Filename: ${found.filename}`);

  const buf = await gmail.downloadAttachment(found.messageId, found.attachmentId);
  const svc = new DocumentExtractionService();
  const text = await svc.extractText(buf);
  console.log(`\nExtracted text length: ${text.length} chars\n`);

  // Print lines that look like they contain commission or sale price info
  const lines = text.split(/\n+/);
  console.log("=== Lines mentioning dollars / commission / price ===");
  for (const line of lines) {
    if (
      /(\$[\d,]+\.?\d*|\bcommission\b|\bsale[s]?\s+price\b|\breferral\b|\bpurchase price\b|\bearnest\b)/i.test(
        line,
      )
    ) {
      console.log("  " + line.replace(/\s+/g, " ").trim().slice(0, 160));
    }
  }

  console.log("\n=== Financials extraction attempt ===");
  const f = svc.financialsFromText(text, (row.side as "buy" | "sell") ?? null);
  console.log(JSON.stringify(f, null, 2));

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
