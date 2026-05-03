"use client";

import { useState } from "react";
import { Sparkles, Loader2, Send } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export function HelpChat({ suggested }: { suggested: string[] }) {
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    setHistory((h) => [...h, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setHistory((h) => [...h, { role: "assistant", text: data.text }]);
    } catch (e) {
      setHistory((h) => [
        ...h,
        {
          role: "assistant",
          text:
            "Couldn't reach the assistant: " +
            (e instanceof Error ? e.message : "unknown"),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      {history.length === 0 ? (
        <div>
          <p className="text-sm text-text-muted">
            <Sparkles
              className="mr-1 inline h-3.5 w-3.5"
              strokeWidth={2}
            />
            Try one of these, or type your own:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggested.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => ask(q)}
                className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text hover:border-brand-500 hover:text-brand-700"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-50/40 dark:text-brand-700"
                  : "rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm"
              }
            >
              {m.role === "assistant" ? (
                <span className="prose-sm whitespace-pre-wrap">{m.text}</span>
              ) : (
                m.text
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void ask(input.trim());
        }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about REOS…"
          disabled={busy}
          className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2} />
          Ask
        </button>
      </form>
    </section>
  );
}
