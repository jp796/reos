"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface AdapterRow {
  id: string;
  label: string;
  configured: boolean;
}
interface PosterRow extends AdapterRow {
  supports: string[];
}

export function IntegrationsForm(props: {
  activePhotoProvider: string;
  activePoster: string;
  photoSources: AdapterRow[];
  posters: PosterRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [photoProvider, setPhotoProvider] = useState(props.activePhotoProvider);
  const [poster, setPoster] = useState(props.activePoster);

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/integrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listingPhotoProvider: photoProvider,
            socialPoster: poster,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? res.statusText);
        }
        toast.success("Integrations saved");
        router.refresh();
      } catch (e) {
        toast.error(
          "Save failed",
          e instanceof Error ? e.message : "unknown",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <Section
        title="Listing photos"
        sub="Where REOS pulls property photos from when generating social posts and Rezen prep bundles."
      >
        {props.photoSources.map((a) => (
          <AdapterRowCard
            key={a.id}
            id={a.id}
            label={a.label}
            configured={a.configured}
            active={a.id === photoProvider}
            onSelect={() => setPhotoProvider(a.id)}
          />
        ))}
      </Section>

      <Section
        title="Social posting"
        sub="How REOS publishes generated posts. Falls back to copy-to-clipboard when nothing is wired."
      >
        {props.posters.map((a) => (
          <AdapterRowCard
            key={a.id}
            id={a.id}
            label={a.label}
            sub={a.supports.join(" · ")}
            configured={a.configured}
            active={a.id === poster}
            onSelect={() => setPoster(a.id)}
          />
        ))}
      </Section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="reos-label">{title}</div>
      {sub && <p className="mb-2 mt-0.5 text-xs text-text-muted">{sub}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function AdapterRowCard({
  label,
  sub,
  configured,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  sub?: string;
  configured: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors " +
        (active
          ? "border-brand-500 bg-brand-50/40 dark:bg-brand-50/10"
          : "border-border bg-surface hover:border-border-strong")
      }
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-text-muted">{sub}</div>}
      </div>
      <div className="flex items-center gap-2">
        {configured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <Check className="h-3 w-3" strokeWidth={2} /> Configured
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted ring-1 ring-border">
            <X className="h-3 w-3" strokeWidth={2} /> Stub
          </span>
        )}
      </div>
    </button>
  );
}
