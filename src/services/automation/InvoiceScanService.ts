/**
 * InvoiceScanService
 *
 * Scans every transaction's SmartFolder label for invoice-style
 * emails + attachments (inspection, HOA, warranty, utility,
 * repair, title). Detected rows land in InvoiceEntry for the user
 * to review/confirm.
 *
 * Intentionally broad on detection and conservative on dedup:
 * pending rows stay in the queue until user confirms or ignores,
 * so a mis-classified email doesn't become a silent P&L line.
 */

import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";

export interface InvoiceScanResult {
  scanned: number;
  created: number;
  skipped: number;
  errored: number;
  details: Array<{
    transactionId: string;
    address: string | null;
    created: number;
  }>;
}

interface CategoryRule {
  id: string;
  label: string;
  subjectRes: RegExp[];
  fromRes: RegExp[];
  filenameRes: RegExp[];
}

const CATEGORIES: CategoryRule[] = [
  {
    id: "inspection",
    label: "Inspection",
    subjectRes: [/inspection\s+(?:report|invoice|bill|fee)/i, /home\s+inspection/i],
    fromRes: [/inspection/i, /inspect/i],
    filenameRes: [/inspection/i, /home[_\s-]*inspection/i],
  },
  {
    id: "hoa",
    label: "HOA",
    subjectRes: [/\bhoa\b/i, /home.?owners?\s+association/i, /\bdues\b/i],
    fromRes: [/hoa/i, /association/i],
    filenameRes: [/\bhoa\b/i, /association/i, /cc&?rs?/i, /bylaws/i],
  },
  {
    id: "warranty",
    label: "Home warranty",
    subjectRes: [/home\s+warranty/i, /\bwarranty\s+(?:invoice|policy|cert)/i],
    fromRes: [/warranty/i, /ahs/i, /fidelity/i, /2-10/i],
    filenameRes: [/warranty/i],
  },
  {
    id: "repair",
    label: "Repair / service",
    subjectRes: [/repair\s+(?:invoice|estimate|bill)/i, /service\s+invoice/i],
    fromRes: [/plumbing/i, /electric/i, /roofing/i, /hvac/i, /contractor/i],
    filenameRes: [/repair/i, /estimate/i, /invoice/i, /receipt/i],
  },
  {
    id: "title",
    label: "Title / escrow",
    subjectRes: [/title\s+invoice/i, /escrow\s+(?:invoice|fee)/i, /closing\s+(?:invoice|fee)/i],
    fromRes: [/title/i, /escrow/i],
    filenameRes: [/title[_\s-]*invoice/i, /closing[_\s-]*invoice/i],
  },
  {
    id: "utility",
    label: "Utility transfer",
    subjectRes: [/utility\s+transfer/i, /final\s+(?:bill|reading)/i, /water.*transfer/i],
    fromRes: [/utility/i, /\bwater\b/i, /\belectric\b/i, /\bgas\b/i],
    filenameRes: [/utility/i],
  },
];

const GENERIC_INVOICE_KEYWORDS = /\b(invoice|bill|statement|receipt|quote|estimate)\b/i;

export class InvoiceScanService {
  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
  ) {}

  async scanAll(accountId: string): Promise<InvoiceScanResult> {
    const out: InvoiceScanResult = {
      scanned: 0,
      created: 0,
      skipped: 0,
      errored: 0,
      details: [],
    };

    const txns = await this.db.transaction.findMany({
      where: {
        accountId,
        smartFolderLabelId: { not: null },
        status: { notIn: ["dead"] },
      },
      select: {
        id: true,
        propertyAddress: true,
        smartFolderLabelId: true,
      },
    });

    for (const txn of txns) {
      if (!txn.smartFolderLabelId) continue;
      out.scanned++;
      let created = 0;

      try {
        const { threads } = await this.gmail.searchThreadsPaged({
          labelIds: [txn.smartFolderLabelId],
          q: "has:attachment",
          maxTotal: 60,
        });

        for (const t of threads) {
          if (!t.messages) continue;
          for (const m of t.messages) {
            if (!m.id) continue;
            const subject =
              m.payload?.headers?.find(
                (h) => h.name?.toLowerCase() === "subject",
              )?.value ?? "";
            const from =
              m.payload?.headers?.find(
                (h) => h.name?.toLowerCase() === "from",
              )?.value ?? "";
            const dateStr =
              m.payload?.headers?.find(
                (h) => h.name?.toLowerCase() === "date",
              )?.value ?? null;
            const msgDate = dateStr ? new Date(dateStr) : new Date();

            const atts = await this.gmail.getMessageAttachments(m.id);
            for (const a of atts) {
              const cat = classify({
                subject,
                from,
                filename: a.filename,
              });
              if (!cat) continue;

              // Dedup on (accountId, messageId, attachmentId)
              const exists = await this.db.invoiceEntry.findUnique({
                where: {
                  accountId_messageId_attachmentId: {
                    accountId,
                    messageId: m.id,
                    attachmentId: a.attachmentId,
                  },
                },
              });
              if (exists) {
                out.skipped++;
                continue;
              }

              await this.db.invoiceEntry.create({
                data: {
                  accountId,
                  transactionId: txn.id,
                  threadId: t.id ?? "",
                  messageId: m.id,
                  attachmentId: a.attachmentId,
                  filename: a.filename.slice(0, 200),
                  fromEmail: from.slice(0, 200),
                  subject: subject.slice(0, 200),
                  category: cat,
                  invoiceDate: msgDate,
                  snippet: `Subject: ${subject.slice(0, 80)} · From: ${from.slice(0, 80)}`,
                  status: "pending",
                },
              });
              created++;
              out.created++;
            }
          }
        }
      } catch (err) {
        console.warn(
          `invoice scan failed for ${txn.id}:`,
          err instanceof Error ? err.message : err,
        );
        out.errored++;
      }

      out.details.push({
        transactionId: txn.id,
        address: txn.propertyAddress,
        created,
      });
    }

    return out;
  }
}

/** Return a category id if the email+attachment matches, else null. */
function classify(opts: {
  subject: string;
  from: string;
  filename: string;
}): string | null {
  const filenameLooksGeneric = /\.pdf$/i.test(opts.filename);

  for (const cat of CATEGORIES) {
    if (
      cat.subjectRes.some((re) => re.test(opts.subject)) ||
      cat.fromRes.some((re) => re.test(opts.from)) ||
      cat.filenameRes.some((re) => re.test(opts.filename))
    ) {
      return cat.id;
    }
  }

  // Generic invoice keyword fallback — only if the attachment is a PDF
  // (protects against SS/contract attachments that might coincidentally
  // match keyword signals)
  if (
    filenameLooksGeneric &&
    (GENERIC_INVOICE_KEYWORDS.test(opts.subject) ||
      GENERIC_INVOICE_KEYWORDS.test(opts.filename))
  ) {
    // But DON'T classify if it smells like an SS/contract
    if (
      /settlement|closing\s+disclosure|purchase\s+(agreement|contract)|\balta\b|hud-?1/i.test(
        opts.subject + " " + opts.filename,
      )
    ) {
      return null;
    }
    return "other";
  }
  return null;
}
