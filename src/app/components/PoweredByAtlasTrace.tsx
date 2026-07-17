/**
 * PoweredByAtlasTrace — the "REOS · Powered by Atlas Trace™" brand tag.
 * Atlas Trace is REOS's provenance + reasoning layer (the ambient badges,
 * live-read trace, and reconciliation). One reusable tag so every surface
 * shows the mark identically.
 */

export function PoweredByAtlasTrace({
  className = "",
  align = "center",
}: {
  className?: string;
  align?: "center" | "left";
}) {
  return (
    <div
      className={`text-[11px] leading-none text-text-subtle ${align === "center" ? "text-center" : "text-left"} ${className}`}
    >
      REOS · Powered by{" "}
      <span className="font-medium text-text-muted">
        Atlas&nbsp;Trace<sup className="text-[8px]">™</sup>
      </span>
    </div>
  );
}
