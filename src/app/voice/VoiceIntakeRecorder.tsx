"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

type Phase = "idle" | "recording" | "uploading" | "done" | "error";

export function VoiceIntakeRecorder() {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    };
  }, []);

  async function start() {
    try {
      setErrorMsg("");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await upload(blob);
      };
      recorderRef.current = mr;
      mr.start();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(
        () => setSeconds((s) => s + 1),
        1000,
      );
    } catch (e) {
      setPhase("error");
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "Microphone permission denied. Allow access and try again.",
      );
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("uploading");
  }

  async function upload(blob: Blob) {
    try {
      const form = new FormData();
      form.append("audio", blob, "intake.webm");
      const res = await fetch("/api/voice/intake", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setTranscript(data.transcript ?? "");
        throw new Error(data.error ?? res.statusText);
      }
      setTranscript(data.transcript ?? "");
      setPhase("done");
      toast.success("Deal created", "Redirecting…");
      setTimeout(() => {
        router.push(`/transactions/${data.transactionId}`);
      }, 800);
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "upload failed");
    }
  }

  function reset() {
    setPhase("idle");
    setSeconds(0);
    setTranscript("");
    setErrorMsg("");
  }

  return (
    <section className="rounded-md border border-border bg-surface p-6">
      {phase === "idle" && (
        <div className="text-center">
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-base font-medium text-white hover:bg-brand-500"
          >
            <Mic className="h-5 w-5" strokeWidth={2} />
            Start recording
          </button>
          <p className="mt-3 text-xs text-text-muted">
            Browser will ask for mic permission.
          </p>
        </div>
      )}

      {phase === "recording" && (
        <div className="text-center">
          <div className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-red-100 ring-4 ring-red-200 dark:bg-red-950 dark:ring-red-900">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          </div>
          <p className="mt-3 font-display text-2xl font-bold tabular-nums">
            {fmtSeconds(seconds)}
          </p>
          <p className="mt-1 text-xs text-text-muted">Recording…</p>
          <button
            type="button"
            onClick={stop}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-text px-6 py-3 text-base font-medium text-bg hover:opacity-90"
          >
            <Square className="h-4 w-4" strokeWidth={2} />
            Stop &amp; transcribe
          </button>
        </div>
      )}

      {phase === "uploading" && (
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-600" strokeWidth={2} />
          <p className="mt-3 text-sm text-text-muted">
            Transcribing + extracting deal…
          </p>
        </div>
      )}

      {phase === "done" && (
        <div className="text-center">
          <CheckCircle2
            className="mx-auto h-10 w-10 text-emerald-600"
            strokeWidth={2}
          />
          <p className="mt-3 font-display text-lg font-semibold">
            Deal created. Redirecting…
          </p>
          {transcript && (
            <details className="mt-4 rounded border border-border bg-surface-2/40 p-3 text-left text-xs">
              <summary className="cursor-pointer font-medium">
                Transcript
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-text-muted">
                {transcript}
              </p>
            </details>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="text-center">
          <p className="text-sm text-red-700">{errorMsg}</p>
          {transcript && (
            <details className="mt-3 rounded border border-border bg-surface-2/40 p-3 text-left text-xs">
              <summary className="cursor-pointer font-medium">
                Transcript
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-text-muted">
                {transcript}
              </p>
            </details>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-500"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            Try again
          </button>
        </div>
      )}
    </section>
  );
}

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}
