/**
 * PartnerUpdateEmail — builds the weekly "here's how your money is working"
 * update for a private-money partner from the deals they fund. Pure + factual
 * (no invented numbers): status, closing date, and the partner's position per
 * deal. The draft is always reviewed and sent by the user — never auto-blasted.
 */

export interface PartnerDealLine {
  property: string;
  status: string;
  closingDate: Date | null;
  amount: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "under contract",
  listing: "listed",
  pending: "pending close",
  closed: "closed",
  dead: "cancelled",
  terminated: "terminated",
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}
function money(n: number | null): string {
  return n == null ? "" : "$" + Math.round(n).toLocaleString();
}
function shortDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

export function buildPartnerUpdateDraft(
  partner: { name: string },
  deals: PartnerDealLine[],
  fromName: string,
): { subject: string; body: string } {
  const live = deals.filter((d) => !["closed", "dead", "terminated"].includes(d.status));
  const n = live.length;
  const subject =
    n === 0
      ? "A quick update from House Needs Love"
      : `Update on your ${n === 1 ? "investment" : `${n} investments`} — House Needs Love`;

  const lines: string[] = [];
  lines.push(`Hi ${firstName(partner.name)},`);
  lines.push("");
  if (n === 0) {
    lines.push(
      "Just checking in — we don't have an active deal with your capital right now, but you're first on the list as new opportunities come up. I'll reach out the moment one fits.",
    );
  } else {
    lines.push(`Quick update on the ${n === 1 ? "deal" : `${n} deals`} your capital is working on:`);
    lines.push("");
    for (const d of live) {
      const bits = [STATUS_LABEL[d.status] ?? d.status];
      if (d.closingDate) bits.push(`closing ${shortDate(d.closingDate)}`);
      if (d.amount != null) bits.push(`your position ${money(d.amount)}`);
      lines.push(`• ${d.property} — ${bits.join(", ")}`);
    }
    lines.push("");
    lines.push("Everything's on track. Reply here anytime with questions — happy to walk through any of these.");
  }
  lines.push("");
  lines.push("Thank you for partnering with us.");
  lines.push(fromName);

  return { subject, body: lines.join("\n") };
}
