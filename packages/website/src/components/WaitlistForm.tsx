"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

type State = "idle" | "loading" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading" || state === "success") return;

    setState("loading");
    setMessage("");

    try {
      const res = await fetch("/api/hub-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "hub_page" }),
      });

      const data = (await res.json()) as { ok?: boolean; already?: boolean; error?: string };

      if (data.ok) {
        setState("success");
        setMessage(
          data.already
            ? "You're already on the list — we'll be in touch soon."
            : "You're on the list! We'll let you know when Akiba Hub launches.",
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
      <div className="mt-8 flex flex-col items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-green-500/20 px-5 py-3 text-sm font-semibold text-green-300">
          <span className="h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
          {message}
        </div>
        <a href="#campaigns" className="text-sm text-white/40 underline underline-offset-2 hover:text-white/70">
          Explore campaigns while you wait
        </a>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
        aria-label="Akiba Hub waitlist"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") { setState("idle"); setMessage(""); }
          }}
          placeholder="Enter your email"
          disabled={state === "loading"}
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm text-white placeholder-white/40 outline-none transition focus:border-akiba-teal focus:ring-2 focus:ring-akiba-teal/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-60"
        >
          {state === "loading" ? "Joining…" : "Join Waitlist"}
          {state !== "loading" && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      {state === "error" && (
        <p className="text-sm text-red-400">{message}</p>
      )}

      <p className="text-xs text-white/30">No spam. Just a launch notification.</p>
    </div>
  );
}
