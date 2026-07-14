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

const MODEL = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4.1";

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

/** Decode the plain-text body of a message (walks multipart, prefers text/plain). */
function bodyText(msg: gmail_v1.Schema$Message): string {
  const out: string[] = [];
  const walk = (parts?: gmail_v1.Schema$MessagePart[]) => {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        try {
          out.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
        } catch {
          /* ignore */
        }
      }
      if (p.parts) walk(p.parts);
    }
  };
  if (msg.payload?.body?.data) {
    try {
      out.push(Buffer.from(msg.payload.body.data, "base64url").toString("utf8"));
    } catch {
      /* ignore */
    }
  }
  walk(msg.payload?.parts);
  return out.join("\n");
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
Set isAgent=false if this is clearly a title company, lender, inspector, the client, or you can't tell. Only pull fields present in the signature; use null otherwise. Prefer a direct/cell phone.`;

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
      participants: { select: { contact: { select: { primaryEmail: true } } } },
      account: {
        select: {
          brokerageProfile: { select: { agentEmailDomains: true } },
          users: { select: { email: true } },
        },
      },
    },
  });
  if (!txn || txn.coAgentName) return null; // only when missing

  // Everyone we should NOT treat as the other agent.
  const excludeEmails = new Set<string>(
    [
      txn.contact?.primaryEmail ?? null,
      txn.titleCompanyEmail,
      txn.lenderEmail,
      ...txn.participants.map((p) => p.contact?.primaryEmail ?? null),
      ...txn.account.users.map((u) => u.email),
    ]
      .filter((e): e is string => !!e)
      .map((e) => e.toLowerCase()),
  );
  const ourDomains = new Set((txn.account.brokerageProfile?.agentEmailDomains ?? []).map((d) => d.toLowerCase()));

  // Gather this deal's threads (folder + address search).
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
    return null;
  }

  // Rank external senders by frequency; skip excluded people + our domains.
  const freq = new Map<string, { count: number; msg: gmail_v1.Schema$Message; name: string | null }>();
  for (const t of threads) {
    for (const msg of t.messages ?? []) {
      const from = parseFrom(header(msg, "from"));
      if (!from.email || excludeEmails.has(from.email) || ourDomains.has(domainOf(from.email))) continue;
      const cur = freq.get(from.email);
      if (cur) cur.count++;
      else freq.set(from.email, { count: 1, msg, name: from.name });
    }
  }
  const candidates = [...freq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
  if (candidates.length === 0) return null;

  // AI-read the top candidates' signatures until one is confirmed an agent.
  for (const [email, info] of candidates) {
    const result = await readSignature({
      fromName: info.name,
      fromEmail: email,
      subject: header(info.msg, "subject"),
      body: bodyText(info.msg),
    });
    if (result) {
      await db.transaction.update({
        where: { id: txn.id },
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
  return null;
}
