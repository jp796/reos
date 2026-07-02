/**
 * FormFillService — fill a blank PDF form with deal data.
 *
 * Two-layer design:
 *  1. Mechanical fill (pdf-lib) — reads a PDF's AcroForm fields (text,
 *     checkbox, dropdown, radio) and writes values into them. Reliable
 *     and exact for fillable forms (the association / state templates
 *     that ship with real form fields).
 *  2. AI mapping — given the form's field names + a deal's facts, the
 *     model decides what value each field should get (handles the messy
 *     real-world naming: "PurchasePrice", "Sales Price", "1a_price"…).
 *
 * Flat PDFs (no AcroForm) are detected and reported so the caller can
 * fall back (coordinate overlay is a separate, later capability).
 */

import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from "pdf-lib";

const MODEL = "gpt-4o-mini";

export interface FormField {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "radio" | "other";
  options?: string[]; // for dropdown / radio
}

export interface FieldValue {
  name: string;
  value: string | boolean; // string for text/dropdown/radio, boolean for checkbox
}

/** Detect an Adobe-only XFA form (carries an /XFA entry in its AcroForm
 *  dict). These render as the "install Adobe" page everywhere except
 *  Adobe, so they can't be filled/mapped until flattened. */
export function detectXfa(pdfBytes: Uint8Array): boolean {
  return Buffer.from(pdfBytes).includes("/XFA");
}

/** Read the fillable fields from a PDF. Empty array = flat PDF. */
export async function readFormFields(pdfBytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const out: FormField[] = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) out.push({ name, type: "text" });
    else if (f instanceof PDFCheckBox) out.push({ name, type: "checkbox" });
    else if (f instanceof PDFDropdown) out.push({ name, type: "dropdown", options: f.getOptions() });
    else if (f instanceof PDFRadioGroup) out.push({ name, type: "radio", options: f.getOptions() });
    else out.push({ name, type: "other" });
  }
  return out;
}

/** Write values into a PDF's form fields. Unknown/failed fields are
 *  skipped (never throw on one bad field). Optionally flatten so the
 *  values are baked in and the form can't be edited after signing. */
export async function applyFieldValues(
  pdfBytes: Uint8Array,
  values: FieldValue[],
  opts?: { flatten?: boolean },
): Promise<{ bytes: Uint8Array; filled: number; failed: string[] }> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  let filled = 0;
  const failed: string[] = [];

  for (const { name, value } of values) {
    try {
      const field = form.getField(name); // throws if missing → caught below
      if (field instanceof PDFTextField) {
        field.setText(String(value ?? ""));
      } else if (field instanceof PDFCheckBox) {
        if (value === true || value === "true" || value === "yes") field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown) {
        field.select(String(value));
      } else if (field instanceof PDFRadioGroup) {
        field.select(String(value));
      } else {
        failed.push(name);
        continue;
      }
      filled++;
    } catch {
      failed.push(name);
    }
  }

  if (opts?.flatten) {
    try { form.flatten(); } catch { /* leave editable if flatten fails */ }
  }
  const bytes = await doc.save();
  return { bytes, filled, failed };
}

const SYSTEM = `You map real-estate deal facts onto the fields of a blank PDF form. You are precise: you only fill a field when a fact clearly belongs in it, you use the exact date/number format the field implies, and you leave a field blank (omit it) when you don't have the fact. You never invent values.`;

/** Ask the model which value each form field should get, given the deal
 *  facts. Returns only the fields it's confident about. */
export async function aiMapFields(
  apiKey: string,
  fields: FormField[],
  dealFacts: Record<string, unknown>,
): Promise<FieldValue[]> {
  if (fields.length === 0) return [];
  const fieldList = fields
    .map((f) => `  - "${f.name}" (${f.type}${f.options ? `: ${f.options.join("|")}` : ""})`)
    .join("\n");
  const factLines = Object.entries(dealFacts)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `  - ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");

  const prompt = `FORM FIELDS (fill only those that clearly map to a fact):
${fieldList}

DEAL FACTS:
${factLines}

For each field you can confidently fill, return its exact name and the value.
- text: the string value (dates as they should appear on the form; money as digits, e.g. 559000 or "$559,000" if the field expects it).
- checkbox: true/false.
- dropdown/radio: EXACTLY one of the listed options.
Omit any field you're unsure about. Return ONLY JSON:
{ "values": [ { "name": "<exact field name>", "value": "<string>" | true | false } ] }`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { values?: unknown };
  if (!Array.isArray(parsed.values)) return [];
  const valid = new Set(fields.map((f) => f.name));
  return parsed.values
    .filter((v): v is FieldValue =>
      !!v && typeof v === "object" && typeof (v as FieldValue).name === "string" && valid.has((v as FieldValue).name),
    )
    .map((v) => ({ name: v.name, value: v.value }));
}

/** End-to-end: read a form's fields, AI-map from deal facts, fill. */
export async function aiFillForm(
  apiKey: string,
  pdfBytes: Uint8Array,
  dealFacts: Record<string, unknown>,
  opts?: { flatten?: boolean },
): Promise<{
  bytes: Uint8Array;
  fields: FormField[];
  values: FieldValue[];
  filled: number;
  failed: string[];
  flat: boolean;
}> {
  const fields = await readFormFields(pdfBytes);
  if (fields.length === 0) {
    return { bytes: pdfBytes, fields, values: [], filled: 0, failed: [], flat: true };
  }
  const values = await aiMapFields(apiKey, fields, dealFacts);
  const { bytes, filled, failed } = await applyFieldValues(pdfBytes, values, opts);
  return { bytes, fields, values, filled, failed, flat: false };
}
