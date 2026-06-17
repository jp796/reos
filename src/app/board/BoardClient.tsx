"use client";

/**
 * BoardClient — drag-and-drop kanban for investment deals. Columns are
 * the strategy's stages; cards are deals. Dragging a card to a column
 * sets that deal's stage (POST /api/assets/[id]/set-stage) and seeds the
 * stage's tasks. Native HTML5 DnD — no extra dependencies.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GripVertical, User } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Stage {
  key: string;
  name: string;
}
interface Card {
  assetId: string;
  transactionId: string;
  address: string;
  contactName: string;
  assignee: string | null;
  stageKey: string | null;
  metricLabel: string;
  metricValue: string | null;
  closingDate: string | null;
}

export function BoardClient({
  stages,
  cards: initialCards,
}: {
  strategy: string;
  stages: Stage[];
  cards: Card[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  async function moveTo(stageKey: string) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const card = cards.find((c) => c.assetId === id);
    if (!card || card.stageKey === stageKey) return;
    const prevStage = card.stageKey;
    setCards((cs) => cs.map((c) => (c.assetId === id ? { ...c, stageKey } : c)));
    try {
      const res = await fetch(`/api/assets/${id}/set-stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCards((cs) => cs.map((c) => (c.assetId === id ? { ...c, stageKey: prevStage } : c)));
        toast.error("Couldn't move deal", data.message ?? res.statusText);
        return;
      }
      toast.success(
        "Stage updated",
        `${card.address} → ${stages.find((s) => s.key === stageKey)?.name}${data.created ? ` · ${data.created} task(s) added` : ""}`,
      );
      router.refresh();
    } catch (e) {
      setCards((cs) => cs.map((c) => (c.assetId === id ? { ...c, stageKey: prevStage } : c)));
      toast.error("Couldn't move deal", e instanceof Error ? e.message : "error");
    }
  }

  if (stages.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-10 text-center text-sm text-text-muted">
        This strategy has no stage lifecycle yet.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {stages.map((stage, i) => {
        const colCards = cards.filter(
          (c) => c.stageKey === stage.key || (c.stageKey == null && i === 0),
        );
        const over = overCol === stage.key;
        return (
          <div
            key={stage.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(stage.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === stage.key ? null : c))}
            onDrop={() => moveTo(stage.key)}
            className={`flex w-72 shrink-0 flex-col rounded-md border bg-surface-2/40 ${
              over ? "border-brand-500 ring-1 ring-brand-300" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-text">
                <span className="mr-1 text-text-subtle tabular-nums">{i + 1}.</span>
                {stage.name}
              </span>
              <span className="rounded-full bg-surface px-1.5 text-[11px] tabular-nums text-text-muted">
                {colCards.length}
              </span>
            </div>
            <div className="flex min-h-[60px] flex-col gap-2 p-2">
              {colCards.map((c) => (
                <div
                  key={c.assetId}
                  draggable
                  onDragStart={() => setDragId(c.assetId)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  className={`group rounded-md border border-border bg-surface p-2.5 text-xs shadow-sm transition-shadow hover:shadow ${
                    dragId === c.assetId ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-text-subtle" strokeWidth={1.8} />
                    <Link
                      href={`/transactions/${c.transactionId}`}
                      className="min-w-0 flex-1 font-medium text-text hover:text-brand-700 hover:underline"
                    >
                      {c.address}
                    </Link>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 pl-5 text-[11px] text-text-muted">
                    <span>
                      {c.metricValue ? (
                        <span className="font-medium text-text">{c.metricValue}</span>
                      ) : c.closingDate ? (
                        <>Close {c.closingDate}</>
                      ) : (
                        "—"
                      )}
                    </span>
                    {c.assignee && (
                      <span className="inline-flex items-center gap-0.5">
                        <User className="h-3 w-3" strokeWidth={2} />
                        {c.assignee.split(" ")[0]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {colCards.length === 0 && (
                <div className="rounded border border-dashed border-border/60 py-4 text-center text-[11px] text-text-subtle">
                  drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
