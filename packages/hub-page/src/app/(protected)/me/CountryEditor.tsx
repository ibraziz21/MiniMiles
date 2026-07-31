"use client";

import { useState } from "react";
import { MapPin, Check, Loader2 } from "lucide-react";
import clsx from "clsx";

// Quest verifier for "Tell us where you shop" (merchant-shopping-quests-spec.md
// §3/§5) — writes hub_user_profiles.country via PATCH /api/me, not the legacy
// wallet-row `users.country`. `initialCountry` may be prefilled from that
// legacy value, but this control is the Hub-native source of truth going
// forward.

const COUNTRIES = [
  "Kenya", "Uganda", "Tanzania", "Nigeria", "Ghana", "Rwanda",
  "South Africa", "Zambia", "Ethiopia", "Other",
];

export function CountryEditor({ initialCountry }: { initialCountry: string | null }) {
  const [country, setCountry] = useState(initialCountry ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(value: string) {
    setCountry(value);
    setStatus("saving");
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: value }),
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-akiba-line bg-akiba-card px-3 py-1 text-xs font-medium text-akiba-muted">
      <MapPin className="h-3 w-3 shrink-0" />
      <select
        value={country}
        onChange={(e) => save(e.target.value)}
        className="bg-transparent text-xs font-medium text-akiba-muted outline-none"
      >
        <option value="" disabled>
          Where do you shop?
        </option>
        {COUNTRIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {status === "saving" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
      {status === "saved" && <Check className={clsx("h-3 w-3 shrink-0 text-akiba-teal")} />}
    </div>
  );
}
