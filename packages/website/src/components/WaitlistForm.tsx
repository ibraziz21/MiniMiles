"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "idle" | "loading" | "success" | "error";

type WaitlistFormProps = {
  /** Stored against the lead so we can tell the hub page from the app band. */
  source?: string;
  /** "dark" is for the ink-coloured hub hero; "light" for white cards. */
  tone?: "dark" | "light";
  submitLabel?: string;
  successMessage?: string;
  footnote?: string;
  className?: string;
};

export function WaitlistForm({
  source = "hub_page",
  tone = "dark",
  submitLabel = "Join Waitlist",
  successMessage = "You're on the list! We'll let you know when Akiba Hub launches.",
  footnote = "No spam. Just a launch notification.",
  className,
}: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const dark = tone === "dark";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading" || state === "success") return;

    setState("loading");
    setMessage("");

    try {
      const res = await fetch("/api/hub-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });

      const data = (await res.json()) as { ok?: boolean; already?: boolean; error?: string };

      if (data.ok) {
        setState("success");
        setMessage(
          data.already ? "You're already on the list. We'll be in touch soon." : successMessage,
        );
        setEmail("");
      } else {
        setState("error");
        setMessage(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setState("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (state === "success") {
    return (
      <div className={cn("flex flex-col items-center gap-2", className)}>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold",
            dark ? "bg-green-500/20 text-green-300" : "bg-green-50 text-green-700",
          )}
        >
          <span
            className={cn("h-2 w-2 rounded-full", dark ? "bg-green-400" : "bg-green-600")}
            aria-hidden="true"
          />
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
        aria-label="Akiba waitlist"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") {
              setState("idle");
              setMessage("");
            }
          }}
          placeholder="Enter your email"
          disabled={state === "loading"}
          className={cn(
            "min-w-0 flex-1 rounded-full border px-5 py-3 text-sm outline-none transition focus:border-akiba-teal focus:ring-2 focus:ring-akiba-teal/30 disabled:opacity-50",
            dark
              ? "border-white/20 bg-white/10 text-white placeholder-white/40"
              : "border-akiba-line bg-akiba-paper text-akiba-ink placeholder-akiba-muted/60",
          )}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-60"
        >
          {state === "loading" ? "Joining…" : submitLabel}
          {state !== "loading" && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      {state === "error" && (
        <p className={cn("text-sm", dark ? "text-red-400" : "text-red-600")}>{message}</p>
      )}

      <p className={cn("text-xs", dark ? "text-white/30" : "text-akiba-muted/70")}>{footnote}</p>
    </div>
  );
}
