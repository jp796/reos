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
    <main className="mx-auto max-w-6xl">
      <header className="flex items-end justify-between">
        <div>
          <div className="reos-label">Contacts</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold">
            People
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            <span className="tabular-nums">{total.toLocaleString()}</span>{" "}
            synced from Follow Up Boss
            {total > contacts.length && (
              <>
                {" ("}showing first{" "}
                <span className="tabular-nums">{contacts.length}</span>)
              </>
            )}
          </p>
        </div>
        <SyncButton />
      </header>

      {contacts.length === 0 ? (
        <div className="mt-10 rounded-md border border-dashed border-border bg-surface p-12 text-center">
          <p className="text-text">No contacts yet.</p>
          <p className="mt-2 text-sm text-text-muted">
            Click <span className="font-medium">Sync 10 from FUB</span> to pull
            your first batch.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-left text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Tags</th>
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
                    className="border-b border-border last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5 font-medium text-text">
                      {c.fullName}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {c.primaryEmail || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted tabular-nums">
                      {c.primaryPhone || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {c.sourceName || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {c.assignedAgentName || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted ring-1 ring-border"
                          >
                            {t}
                          </span>
                        ))}
                        {tags.length > 4 && (
                          <span className="text-xs text-text-subtle">
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
