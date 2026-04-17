import Link from "next/link";
import { prisma } from "@/lib/db";
import { SyncButton } from "./SyncButton";

// Fresh DB read on every request so the page reflects latest sync state.
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await prisma.contact.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const total = await prisma.contact.count();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          ← Home
        </Link>
      </nav>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total.toLocaleString()} contact{total === 1 ? "" : "s"} synced from
            Follow Up Boss
            {total > contacts.length && ` (showing first ${contacts.length})`}
          </p>
        </div>
        <SyncButton />
      </div>

      {contacts.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center">
          <p className="text-neutral-600">No contacts yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Click <span className="font-medium">Sync 10 from FUB</span> to pull
            your first batch.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const tags = Array.isArray(c.tagsJson)
                  ? (c.tagsJson as string[])
                  : [];
                return (
                  <tr
                    key={c.id}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60"
                  >
                    <td className="px-4 py-3 font-medium">{c.fullName}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {c.primaryEmail || "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {c.primaryPhone || "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {c.sourceName || "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {c.assignedAgentName || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
                          >
                            {t}
                          </span>
                        ))}
                        {tags.length > 4 && (
                          <span className="text-xs text-neutral-500">
                            +{tags.length - 4}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
