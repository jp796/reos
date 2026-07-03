/**
 * /forms/[id]/map — the flat-form field mapper (auto-place + nudge).
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { FieldMapper } from "./FieldMapper";

export const dynamic = "force-dynamic";

export default async function MapFormPage(props: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  const { id } = await props.params;

  const form = await prisma.formTemplate.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, name: true, isFlat: true, isXfa: true, hasText: true },
  });
  if (!form) return notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="reos-label">Field mapper</div>
          <h1 className="font-display text-display-md font-semibold">{form.name}</h1>
        </div>
        <Link href="/forms" className="text-sm text-text-muted hover:text-text">
          ← Forms
        </Link>
      </div>
      {form.isXfa ? (
        <p className="text-sm text-amber-600">
          This form is still unflattened XFA — re-upload it so REOS can flatten it first.
        </p>
      ) : !form.isFlat ? (
        <p className="text-sm text-text-muted">
          This is a fillable form — it fills automatically, no mapping needed.
        </p>
      ) : (
        <FieldMapper formId={form.id} formName={form.name} />
      )}
    </main>
  );
}
