/**
 * /settings/task-templates — manage reusable + AI-generated task
 * checklists. Apply them to any deal from its Tasks tab.
 */

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { TaskTemplatesManager } from "./TaskTemplatesManager";

export const dynamic = "force-dynamic";

export default async function TaskTemplatesPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-h1 font-semibold">Task templates</h1>
      <p className="mt-1 text-sm text-text-muted">
        Reusable task checklists that apply to a deal in one click — with due
        dates derived from each deal&rsquo;s milestones. Generate one with Atlas
        or build your own, then apply it from a deal&rsquo;s Tasks tab.
      </p>
      <div className="mt-6">
        <TaskTemplatesManager />
      </div>
    </div>
  );
}
