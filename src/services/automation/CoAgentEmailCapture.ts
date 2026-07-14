/**
 * CoAgentEmailCapture — pull the OTHER-SIDE agent from the deal's emails when
 * the contract doesn't name them (the common buy-side case: the listing agent
 * isn't in the buyer's offer).
 *
 * Strategy: look at who's emailing about the deal, drop everyone we can
 * identify (our team, the client, title, lender), and AI-read the remaining
 * best candidate's email signature with GPT-4.1 to confirm they're the co-op
 * agent and pull name / brokerage / phone / license. Result is written flagged
 * (coAgentSource = "email_signature") so the UI asks the user to verify.
 */

import type { PrismaClient } from "@prisma/client";
import type { gmail_v1 } from "googleapis";
import type { GmailService } from "@/services/integrations/GmailService";

const MODEL = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4.1-mini";

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function parseFrom(from: string): { name: string | null; email: string | null } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2]?.trim().toLowerCase() || null };
  const bare = from.trim().toLowerCase();
  return { name: null, email: /@/.test(bare) ? bare : null };
}
const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Automated / no-reply senders (e-sign services, mailers) — never an agent,
 *  and their bodies carry OTHER people's signatures, causing false positives. */
const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|mailer|bounce|mailgun|esign|docusign|dotloop|hellosign|skyslope|@.*\.esignonline)/i;

/** Strip HTML to readable text so signatures in HTML-only emails are legible. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decode a message body — prefers text/plain, falls back to HTML (stripped),
 *  so signatures in HTML-only emails are readable. */
function bodyText(msg: gmail_v1.Schema$Message): string {
  const plain: string[] = [];
  const html: string[] = [];
  const decode = (data: string) => {
    try {
      return Buffer.from(data, "base64url").toString("utf8");
    } catch {
      return "";
    }
  };
  const walk = (parts?: gmail_v1.Schema$MessagePart[]) => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
      else if (p.mimeType === "text/html" && p.body?.data) html.push(stripHtml(decode(p.body.data)));
      if (p.parts) walk(p.parts);
    }
  };
  if (msg.payload?.body?.data) {
    const raw = decode(msg.payload.body.data);
    if ((msg.payload.mimeType ?? "").includes("html")) html.push(stripHtml(raw));
    else plain.push(raw);
  }
  walk(msg.payload?.parts);
  const joinedPlain = plain.join("\n").trim();
  return joinedPlain.length > 40 ? joinedPlain : html.join("\n").trim();
}

export interface CoAgentResult {
  name: string | null;
  brokerage: string | null;
  phone: string | null;
  email: string | null;
  license: string | null;
}

/** Ask GPT-4.1 whether this email is from the other-side real-estate agent, and
 *  pull their contact block from the signature. Returns null if not an agent. */
async function readSignature(input: {
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  body: string;
}): Promise<CoAgentResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = `You are reading one email from a real-estate transaction to identify the OTHER-SIDE real estate AGENT (a licensed Realtor / broker representing the opposite party), NOT a title/escrow officer, lender/loan officer, inspector, or the client.

From: ${input.fromName ?? ""} <${input.fromEmail ?? ""}>
Subject: ${input.subject}
Body (signature usually at the bottom):
"""
${input.body.slice(-1500)}
"""

Return STRICT JSON:
{"isAgent": true|false, "name": "...|null", "brokerage": "...|null", "phone": "...|null", "email": "...|null", "license": "...|null"}
Rules:
- isAgent=true when the sender is (or clearly signs as) a real-estate agent/Realtor/broker — including when their email domain or signature is a brokerage (e.g. "…homes.com", "…realty.com", "…properties.com", a named brokerage). Coordinating a purchase/sale, sending disclosures, or scheduling on behalf of a party is agent behavior.
- isAgent=false ONLY if this is clearly a title/escrow company, a lender/loan officer, an inspector/vendor, or the buyer/seller client themselves.
- name: the person's name (from the From line or signature). brokerage: their firm/brokerage name from the signature (NOT just the email domain) when stated, else the domain.
- Only pull fields present; use null otherwise. Prefer a direct/cell phone.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const j = JSON.parse(raw) as CoAgentResult & { isAgent?: boolean };
    if (!j.isAgent || !j.name) return null;
    return { name: j.name, brokerage: j.brokerage ?? null, phone: j.phone ?? null, email: j.email ?? input.fromEmail, license: j.license ?? null };
  } catch {
    return null;
  }
}

export interface CoAgentDiagnostics {
  coAgentAlreadySet: boolean;
  threadsScanned: number;
  excludedEmails: string[];
  ourDomains: string[];
  candidates: Array<{ email: string; name: string | null; count: number }>;
  verdicts: Array<{ email: string; isAgent: boolean; result: CoAgentResult | null }>;
}

/** Dry-run the co-agent capture and report what it saw — for debugging why a
 *  deal's other agent did or didn't get pulled. Writes nothing. */
export async function diagnoseCoAgentFromEmails(
  db: PrismaClient,
  gmail: GmailService,
  accountId: string,
  transactionId: string,
): Promise<CoAgentDiagnostics> {
  const g = await gatherCandidates(db, gmail, accountId, transactionId);
  const out: CoAgentDiagnostics = {
    coAgentAlreadySet: g.coAgentAlreadySet,
    threadsScanned: g.threadsScanned,
    excludedEmails: [...g.excludeEmails],
    ourDomains: [...g.ourDomains],
    candidates: g.candidates.map(([email, i]) => ({ email, name: i.name, count: i.count })),
    verdicts: [],
  };
  for (const [email, info] of g.candidates) {
    const result = await readSignature({
      fromName: info.name,
      fromEmail: email,
      subject: header(info.msg, "subject"),
      body: bodyText(info.msg),
    });
    out.verdicts.push({ email, isAgent: !!result, result });
  }
  return out;
}

interface Gathered {
  txnId: string | null;
  coAgentAlreadySet: boolean;
  threadsScanned: number;
  excludeEmails: Set<string>;
  ourDomains: Set<string>;
  candidates: Array<[string, { count: number; msg: gmail_v1.Schema$Message; name: string | null }]>;
}

/** Shared candidate-gathering used by both capture + diagnose. */
async function gatherCandidates(
  db: PrismaClient,
  gmail: GmailService,
  accountId: string,
  transactionId: string,
): Promise<Gathered> {
  const empty: Gathered = { txnId: null, coAgentAlreadySet: false, threadsScanned: 0, excludeEmails: new Set(), ourDomains: new Set(), candidates: [] };
  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    select: {
      id: true,
      coAgentName: true,
      propertyAddress: true,
      smartFolderLabelId: true,
      titleCompanyEmail: true,
      lenderEmail: true,
      contact: { select: { primaryEmail: true } },
      participants: { select: { role: true, contact: { select: { primaryEmail: true } } } },
      account: {
        select: {
          brokerageProfile: { select: { agentEmailDomains: true } },
          users: { select: { email: true } },
        },
      },
    },
  });
  if (!txn) return empty;

  // Exclude only the CLIENT side (co-buyer/co-seller), title, lender, and our
  // team — NOT agent participants. The other agent is often already on the deal
  // as a participant; excluding them would throw out the person we're after.
  const excludeEmails = new Set<string>(
    [
      txn.contact?.primaryEmail ?? null,
      txn.titleCompanyEmail,
      txn.lenderEmail,
      ...txn.participants
        .filter((p) => p.role === "co_buyer" || p.role === "co_seller")
        .map((p) => p.contact?.primaryEmail ?? null),
      ...txn.account.users.map((u) => u.email),
    ]
      .filter((e): e is string => !!e)
      .map((e) => e.toLowerCase()),
  );
  const ourDomains = new Set((txn.account.brokerageProfile?.agentEmailDomains ?? []).map((d) => d.toLowerCase()));

  const street = txn.propertyAddress?.split(",")[0]?.trim() ?? null;
  const threads: gmail_v1.Schema$Thread[] = [];
  try {
    if (txn.smartFolderLabelId) {
      threads.push(...(await gmail.searchThreadsPaged({ labelIds: [txn.smartFolderLabelId], maxTotal: 20 })).threads);
    }
    if (street && street.length >= 4) {
      threads.push(...(await gmail.searchThreadsPaged({ q: `"${street}" newer_than:180d`, maxTotal: 20 })).threads);
    }
  } catch {
    /* return what we have */
  }

  const freq = new Map<string, { count: number; msg: gmail_v1.Schema$Message; name: string | null; bodyLen: number }>();
  for (const t of threads) {
    for (const msg of t.messages ?? []) {
      const from = parseFrom(header(msg, "from"));
      if (!from.email || excludeEmails.has(from.email) || ourDomains.has(domainOf(from.email))) continue;
      if (AUTOMATED.test(from.email)) continue; // e-sign/mailer services aren't agents
      const len = bodyText(msg).length;
      const cur = freq.get(from.email);
      if (cur) {
        cur.count++;
        // Keep the meatiest message — most likely to carry a full signature.
        if (len > cur.bodyLen) {
          cur.msg = msg;
          cur.bodyLen = len;
        }
      } else {
        freq.set(from.email, { count: 1, msg, name: from.name, bodyLen: len });
      }
    }
  }
  const candidates = [...freq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
  return {
    txnId: txn.id,
    coAgentAlreadySet: !!txn.coAgentName,
    threadsScanned: threads.length,
    excludeEmails,
    ourDomains,
    candidates,
  };
}

/**
 * Fill the co-op agent on a deal from its emails when it's missing. Returns the
 * captured agent (already written, flagged for verification) or null.
 */
export async function captureCoAgentFromEmails(
  db: PrismaClient,
  gmail: GmailService,
  accountId: string,
  transactionId: string,
): Promise<CoAgentResult | null> {
  const g = await gatherCandidates(db, gmail, accountId, transactionId);
  if (!g.txnId || g.coAgentAlreadySet) return null; // only when missing
  if (g.candidates.length === 0) return null;

  // AI-read the top candidates' signatures until one is confirmed an agent.
  for (const [email, info] of g.candidates) {
    const result = await readSignature({
      fromName: info.name,
      fromEmail: email,
      subject: header(info.msg, "subject"),
      body: bodyText(info.msg),
    });
    // Reject anything that resolves back to us / a known non-agent — the OTHER
    // agent is never our team, our domain, the client, title, or the lender.
    if (result) {
      const rEmail = (result.email ?? "").toLowerCase();
      if (rEmail && (g.excludeEmails.has(rEmail) || g.ourDomains.has(domainOf(rEmail)))) {
        continue;
      }
    }
    if (result) {
      await db.transaction.update({
        where: { id: g.txnId },
        data: {
          coAgentName: result.name,
          coAgentBrokerage: result.brokerage,
          coAgentPhone: result.phone,
          coAgentEmail: result.email,
          coAgentLicense: result.license,
          coAgentSource: "email_signature",
        },
      });
      return result;
    }
  }

  // Deterministic fallback: the AI can waver on a thin signature. If a candidate
  // is clearly a real-estate brokerage domain and passed every exclusion
  // (not us / client / title / lender / automated), take them as the other agent
  // — name from the From line, brokerage from the domain — flagged for verify.
  const brokerage = g.candidates.find(
    ([email]) =>
      REALTY_DOMAIN.test(domainOf(email)) &&
      !g.excludeEmails.has(email) &&
      !g.ourDomains.has(domainOf(email)),
  );
  if (brokerage) {
    const [email, info] = brokerage;
    const result: CoAgentResult = {
      name: info.name,
      brokerage: brokerageFromDomain(domainOf(email)),
      phone: null,
      email,
      license: null,
    };
    await db.transaction.update({
      where: { id: g.txnId },
      data: {
        coAgentName: result.name,
        coAgentBrokerage: result.brokerage,
        coAgentEmail: result.email,
        coAgentSource: "email_signature",
      },
    });
    return result;
  }
  return null;
}

/** Real-estate brokerage email domains — a strong "this is an agent" signal. */
const REALTY_DOMAIN = /(homes|realty|realestate|properties|realtor|brokerage|remax|kw\.com|kwcommand|century21|coldwell|exprealty|sothebys|compass\.com)/i;

/** "cheyennehomes.com" → "Cheyenne Homes" for a readable brokerage fallback. */
function brokerageFromDomain(domain: string): string | null {
  const base = domain.replace(/\.(com|net|org|co|us|realty)$/i, "").replace(/[.-]/g, " ").trim();
  if (!base) return null;
  return base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
