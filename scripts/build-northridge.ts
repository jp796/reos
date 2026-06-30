/**
 * Build a COMPLETE transaction from the North Ridge contract:
 * 2 merged extraction passes -> full TC task workflow -> write the deal
 * (transaction + financials + parties/agents + milestones + tasks).
 *   DATABASE_URL=<prod> bun run scripts/build-northridge.ts
 */
import { prisma } from "@/lib/db";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

const ACCOUNT = "owner-account";
const DOC_ID = process.argv[2] ?? "cmqube38g00159lk4i6nysvx6";

const doc = await prisma.document.findUnique({
  where: { id: DOC_ID },
  select: { rawBytes: true, fileName: true },
});
if (!doc?.rawBytes) {
  console.error("no bytes");
  process.exit(1);
}
const buffer = Buffer.from(doc.rawBytes);
const svc = new ContractExtractionService(process.env.OPENAI_API_KEY!);

console.log("Running 2 extraction passes (merging to reduce variance)…");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const [a, b] = (await Promise.all([
  svc.extract(buffer),
  svc.extract(buffer),
])) as any[];

const pick = (k: string) => a[k]?.value ?? b[k]?.value ?? null;
const date = (k: string) => {
  const v = pick(k);
  return v ? new Date(`${v}T12:00:00Z`) : null;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unionBy(arrs: any[][], key = "name") {
  const m = new Map();
  for (const arr of arrs)
    for (const x of arr ?? [])
      if (x?.[key]) m.set(String(x[key]).toLowerCase(), x);
  return [...m.values()];
}
const contingencies = unionBy([
  a.contingencies?.value,
  b.contingencies?.value,
]);
const parties = unionBy([a.partyDetails?.value, b.partyDetails?.value]);
const agents = unionBy([a.agents?.value, b.agents?.value]);

console.log(
  `merged: ${parties.length} parties, ${agents.length} agents, ${contingencies.length} contingencies`,
);

// ── Generate the COMPLETE TC workflow ──────────────────────────────
const payload = {
  dates: {
    effective: pick("effectiveDate"),
    earnestMoneyDue: pick("earnestMoneyDueDate"),
    inspection: pick("inspectionDeadline"),
    inspectionObjection: pick("inspectionObjectionDeadline"),
    financing: pick("financingDeadline"),
    titleCommitment: pick("titleCommitmentDeadline"),
    titleObjection: pick("titleObjectionDeadline"),
    walkthrough: pick("walkthroughDate"),
    closing: pick("closingDate"),
    possession: pick("possessionDate"),
  },
  parties,
  agents,
  contingencies,
  financing: {
    purchasePrice: pick("purchasePrice"),
    earnestMoney: pick("earnestMoneyAmount"),
    loanAmount: pick("loanAmount"),
    type: pick("financingType"),
  },
};
const prompt = `You are an expert buyer-side real-estate transaction coordinator. Produce the COMPLETE task list to coordinate this FINANCED residential purchase from contract to close — the full standard TC workflow, not only the extracted contingencies. Include (when applicable): send fully-executed contract to all parties; confirm earnest money delivery; request the Property Disclosure from the listing agent; review disclosure with the buyer; remind buyer to provide pre-qualification letter and complete the loan application; order/track the appraisal; schedule and complete the inspection; send the inspection objection/notice; negotiate repairs; order the title commitment; review title; send title objection if needed; confirm property & liability insurance commitment; track financing to loan approval / clear-to-close; review the Closing Disclosure with the buyer; confirm funds needed to close; schedule the final walkthrough; coordinate the closing appointment; confirm possession. Anchor each task to the actual dates and reference the actual parties/agents by name. Return JSON {"tasks":[{"title","dueDate","keyedTo","autoEmail","description"}]} where dueDate is ISO YYYY-MM-DD or null, keyedTo is the milestone it tracks, autoEmail true when it's primarily an email. Aim for 18-24 tasks, ordered by due date.

CONTRACT DATA:
${JSON.stringify(payload, null, 2)}`;

console.log("Generating complete TC task workflow…");
const resp = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  }),
});
const tasks = (JSON.parse(
  (((await resp.json()) as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content ?? "{}"),
).tasks ?? []) as Array<{
  title: string;
  dueDate?: string | null;
  keyedTo?: string;
  autoEmail?: boolean;
  description?: string;
}>;
console.log(`generated ${tasks.length} tasks`);

// ── Write the complete transaction ─────────────────────────────────
const primaryBuyer =
  parties.find((p) => p.role === "buyer") ?? parties[0] ?? { name: "Buyer" };
const contact = await prisma.contact.create({
  data: {
    accountId: ACCOUNT,
    fullName: primaryBuyer.name,
    primaryEmail: primaryBuyer.email ?? null,
    rolesJson: ["buyer"],
  },
});

const purchasePrice = pick("purchasePrice");
const commPct = pick("sellerSideCommissionPct") ?? pick("buyerSideCommissionPct");

const txn = await prisma.transaction.create({
  data: {
    accountId: ACCOUNT,
    contactId: contact.id,
    propertyAddress: "1650 North Ridge Dr, Laramie WY",
    city: "Laramie",
    state: "WY",
    transactionType: "buyer",
    side: "buy",
    status: "active",
    stageName: "Under Contract",
    contractDate: date("effectiveDate"),
    closingDate: date("closingDate"),
    possessionDate: date("possessionDate"),
    earnestMoneyDueDate: date("earnestMoneyDueDate"),
    inspectionDate: date("inspectionDeadline"),
    inspectionObjectionDate: date("inspectionObjectionDeadline"),
    financingDeadline: date("financingDeadline"),
    titleDeadline: date("titleCommitmentDeadline"),
    titleObjectionDate: date("titleObjectionDeadline"),
    walkthroughDate: date("walkthroughDate"),
    lenderName: pick("lenderName"),
    titleCompanyName: pick("titleCompanyName"),
  },
});

await prisma.transactionFinancials.create({
  data: {
    transactionId: txn.id,
    salePrice: purchasePrice,
    commissionPercent: commPct,
    grossCommission:
      purchasePrice && commPct ? Math.round(purchasePrice * commPct) : null,
  },
});

// Co-parties + agents as contacts + participants
for (const p of parties) {
  if (p.name === primaryBuyer.name) continue;
  const c = await prisma.contact.create({
    data: {
      accountId: ACCOUNT,
      fullName: p.name,
      primaryEmail: p.email ?? null,
      rolesJson: [p.role],
    },
  });
  await prisma.transactionParticipant.create({
    data: {
      transactionId: txn.id,
      contactId: c.id,
      role: p.role === "seller" ? "co_seller" : "co_buyer",
    },
  });
}
for (const ag of agents) {
  const c = await prisma.contact.create({
    data: {
      accountId: ACCOUNT,
      fullName: ag.name,
      primaryEmail: ag.email ?? null,
      assignedAgentName: ag.brokerage ?? null,
      rolesJson: [ag.role],
    },
  });
  await prisma.transactionParticipant.create({
    data: {
      transactionId: txn.id,
      contactId: c.id,
      role: "other",
      notes: `${ag.role}${ag.brokerage ? ` @ ${ag.brokerage}` : ""}`,
    },
  });
}

// Milestones from every extracted date
const msDefs: Array<[string, string, Date | null]> = [
  ["contract", "Effective Date", date("effectiveDate")],
  ["earnest_money", "Earnest Money Due", date("earnestMoneyDueDate")],
  ["inspection", "Inspection Deadline", date("inspectionDeadline")],
  ["inspection", "Inspection Objection Deadline", date("inspectionObjectionDeadline")],
  ["financing", "Financing Deadline", date("financingDeadline")],
  ["title", "Title Commitment Deadline", date("titleCommitmentDeadline")],
  ["title", "Title Objection Deadline", date("titleObjectionDeadline")],
  ["closing", "Closing Date", date("closingDate")],
  ["walkthrough", "Final Walkthrough", date("walkthroughDate")],
  ["possession", "Possession Date", date("possessionDate")],
];
let mCount = 0;
for (const [type, label, due] of msDefs) {
  if (!due) continue;
  await prisma.milestone.create({
    data: {
      transactionId: txn.id,
      type,
      label,
      dueAt: due,
      source: "extracted",
      confidenceScore: 1,
    },
  });
  mCount++;
}

// Tasks from the generated workflow
let tCount = 0;
for (const t of tasks) {
  await prisma.task.create({
    data: {
      transactionId: txn.id,
      title: t.title,
      description: t.description ?? null,
      dueAt: t.dueDate ? new Date(`${t.dueDate}T12:00:00Z`) : null,
      priority: "normal",
    },
  });
  tCount++;
}

console.log(`\n✅ Built complete transaction:`);
console.log(`   id: ${txn.id}`);
console.log(`   milestones: ${mCount} · tasks: ${tCount} · participants: ${parties.length - 1 + agents.length}`);
console.log(`   https://www.myrealestateos.com/transactions/${txn.id}`);
process.exit(0);
