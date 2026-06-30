/**
 * Probe: can GPT-4o classify + extract a PDF via direct file input?
 * Tests the per-document analysis the synthesis engine will use, on a
 * real SAHLER inspection notice.
 *   DATABASE_URL=<prod> bun run scripts/probe-pdf-classify.ts [fileNameLike]
 */
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const like = process.argv[2] ?? "InspectionContingencyNotice.pdf";
const doc = await prisma.document.findFirst({
  where: { fileName: { contains: like }, transaction: { propertyAddress: { contains: "SAHLER" } } },
  select: { fileName: true, rawBytes: true },
});
if (!doc?.rawBytes) {
  console.error("no doc/bytes for", like);
  process.exit(1);
}
console.log(`Classifying: ${doc.fileName} (${doc.rawBytes.length} bytes)\n`);

const prompt = `You are a real-estate transaction analyst. Classify this document and extract anything that DEFINES or CHANGES the transaction state. Return ONLY JSON:
{
  "docType": "purchase_contract|addendum|amendment|inspection_objection_notice|inspection_resolution_notice|disclosure|loan_estimate|agency_agreement|post_occupancy_agreement|bill_of_sale|wire_fraud_notice|commission_disclosure|other",
  "effectiveDate": "YYYY-MM-DD or null",
  "amendsContract": true or false,
  "fieldChanges": { "closingDate":"YYYY-MM-DD|null", "possessionDate":"YYYY-MM-DD|null", "purchasePrice": number|null },
  "contingencyUpdates": [ { "name":"inspection|appraisal|financing|title|insurance", "status":"objected|satisfied|resolved|waived|removed", "date":"YYYY-MM-DD|null", "detail":"short" } ],
  "summary": "one sentence: what this document is and its effect on the deal"
}
Only include fieldChanges/contingencyUpdates this specific document actually establishes; leave others null/empty.`;

const b64 = Buffer.from(doc.rawBytes).toString("base64");
const resp = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "file",
            file: {
              filename: doc.fileName,
              file_data: `data:application/pdf;base64,${b64}`,
            },
          },
        ],
      },
    ],
  }),
});
const data = await resp.json();
if (!resp.ok) {
  console.error("OpenAI error:", JSON.stringify(data).slice(0, 600));
  process.exit(1);
}
console.log(data.choices?.[0]?.message?.content ?? "(no content)");
process.exit(0);
