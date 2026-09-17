"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2 } from "lucide-react";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { EditSheet } from "@/components/akiba/EditSheet";

// Same fixed list CountryEditor used — country is still the quest verifier
// of record (merchant-shopping-quests-spec.md §5 "Country") via
// set_hub_profile_country; city is a new, lower-stakes free-text field with
// no quest semantics, so it's written alongside country in one PATCH rather
// than needing its own RPC.
const COUNTRIES = [
  "Kenya", "Uganda", "Tanzania", "Nigeria", "Ghana", "Rwanda",
  "South Africa", "Zambia", "Ethiopia", "Other",
];

export function LocationEditor({
  initialCountry,
  initialCity,
}: {
  initialCountry: string | null;
  initialCity: string | null;
}) {
  const router = useRouter();
  const countryId = useId();
  const cityId = useId();
  const [country, setCountry] = useState(initialCountry ?? "");
  const [city, setCity] = useState(initialCity ?? "");
  const [savedCountry, setSavedCountry] = useState(initialCountry);
  const [savedCity, setSavedCity] = useState(initialCity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (!country) {
      setError("Choose a country");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, city: city.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Could not save location");
        return;
      }
      setSavedCountry(country);
      setSavedCity(city.trim() || null);
      close();
      router.refresh();
    } catch {
      setError("Could not save location");
    } finally {
      setSaving(false);
    }
  }

  const description = savedCity && savedCountry
    ? `${savedCity}, ${savedCountry}`
    : savedCountry ?? "Add your location";

  return (
    <EditSheet
      title="Location"
      trigger={(open) => (
        <SettingsRow
          icon={<MapPin className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
          label="Location"
          description={description}
          onClick={open}
        />
      )}
    >
      {(close) => (
        <form onSubmit={(e) => save(e, close)} className="space-y-3 pb-2">
          <p className="text-xs text-akiba-muted">
            Helps us surface nearby merchants and local offers.
          </p>
          <div>
            <label htmlFor={countryId} className="mb-1 block text-xs font-medium text-akiba-muted">
              Country
            </label>
            <select
              id={countryId}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-xl border border-akiba-line bg-white px-4 py-2.5 text-sm text-akiba-ink focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <option value="" disabled>Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={cityId} className="mb-1 block text-xs font-medium text-akiba-muted">
              City (optional)
            </label>
            <input
              id={cityId}
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Nairobi"
              className="w-full rounded-xl border border-akiba-line bg-white px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={saving || !country}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save location"}
          </button>
        </form>
      )}
    </EditSheet>
  );
}
