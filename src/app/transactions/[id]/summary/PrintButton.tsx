"use client";

import { Printer } from "lucide-react";

export function PrintButton({ accent }: { accent: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ backgroundColor: accent }}
      className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 print:hidden"
    >
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </button>
  );
}
