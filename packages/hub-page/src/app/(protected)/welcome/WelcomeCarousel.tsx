"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Award, MapPin, QrCode, ShieldCheck, Tag } from "lucide-react";
import { drawPassQr } from "@/lib/akiba/passQr";
import { useLivePassToken } from "@/lib/akiba/useLivePassToken";
import { normalizeCountry } from "@/lib/akiba/countryCodes";
import { track } from "@/lib/analytics/track";

const COUNTRIES = ["Kenya", "Uganda", "Tanzania", "Nigeria", "Ghana", "Rwanda", "South Africa", "Zambia", "Ethiopia", "Other"];
const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
const inputClass = "min-h-12 w-full rounded-xl border border-akiba-line bg-white px-4 py-3 text-base text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal disabled:bg-akiba-card disabled:text-akiba-muted";
const primaryClass = "min-h-12 w-full rounded-2xl bg-akiba-teal px-4 py-3.5 text-sm font-semibold text-white hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2";

async function mutate(path: string, method: string, body: object) {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (response.status === 401) throw new Error("Your session expired. Sign in again to continue.");
  if (!response.ok) throw new Error(result.error?.message ?? "We couldn’t save your progress. Please try again.");
  return result.data;
}

function PassReveal({ passId, displayLabel }: { passId: string; displayLabel: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { currentPayload } = useLivePassToken(passId);
  useEffect(() => {
    if (canvas.current) void drawPassQr(canvas.current, currentPayload, 220);
  }, [currentPayload]);
  return <div className="flex flex-col items-center text-center">
    <div className="rounded-2xl bg-white p-3 shadow-chip"><canvas ref={canvas} role="img" aria-label="Your Akiba Pass QR code" /></div>
    <p className="mt-3 text-sm font-medium text-akiba-ink">{displayLabel}</p>
  </div>;
}

export function WelcomeCarousel(props: {
  userId: string; passId: string; displayLabel: string; next: string;
  username: string; country: string; city: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState(props.username);
  const [savedUsername, setSavedUsername] = useState(props.username);
  const [country, setCountry] = useState(() => COUNTRIES.find(value => value.toLowerCase() === props.country.toLowerCase() || (normalizeCountry(value) !== null && normalizeCountry(value) === normalizeCountry(props.country))) ?? "");
  const [city, setCity] = useState(props.city);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const progressKey = `akiba.web-onboarding.${props.userId}`;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(progressKey);
      // Saved profile fields come from the server, never browser storage.
      if (saved === "1" || saved === "2") setStep(saved === "2" && props.username ? 2 : 1);
    } catch { /* Storage can be unavailable in private browsers. */ }
  }, [progressKey, props.username]);

  useEffect(() => {
    heading.current?.focus();
    track("welcome_slide_view", { i: step });
  }, [step]);

  function go(nextStep: number) {
    setError(null);
    setStep(nextStep);
    try { sessionStorage.setItem(progressKey, String(nextStep)); } catch { /* Optional resume hint. */ }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const normalized = username.trim().toLowerCase();
    if (!savedUsername && !USERNAME_RULE.test(normalized)) {
      setError("Choose a username with 3–20 lowercase letters, numbers or underscores.");
      return;
    }
    if (!country) { setError("Choose your country to continue."); return; }
    setBusy(true); setError(null);
    try {
      // Save optional fields before the username so a partial failure never
      // retries a successful username change and triggers its cooldown.
      await mutate("/api/v1/me/settings", "PATCH", { country, city: city.trim() });
      if (!savedUsername) {
        await mutate("/api/v1/me/settings", "PATCH", { username: normalized });
        setUsername(normalized);
        setSavedUsername(normalized);
      }
      go(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function finish() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await mutate("/api/v1/me/onboarding/complete", "POST", {});
      try { sessionStorage.removeItem(progressKey); } catch { /* Optional resume hint. */ }
      track("welcome_completed");
      router.replace(props.next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes("session expired") ? cause.message : "We couldn’t save your progress. Check your connection and try again.");
      setBusy(false);
    }
  }

  return <main className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-md flex-col px-5 py-8 sm:px-6">
    <p className="text-xs font-semibold uppercase tracking-widest text-akiba-teal">Step {step + 1} of 3</p>
    <div className="mt-3 flex gap-2" aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className={`h-1 flex-1 rounded-full ${index <= step ? "bg-akiba-teal" : "bg-akiba-line"}`} />)}</div>
    <h1 ref={heading} tabIndex={-1} className="mt-8 font-sterling text-3xl font-semibold text-akiba-ink outline-none">{["Welcome to Akiba", "Set up your profile", "Your Akiba Pass is ready"][step]}</h1>

    {step === 0 ? <>
      <p className="mt-3 text-sm leading-6 text-akiba-muted">Turn everyday spending at local merchants into rewards you can use.</p>
      <div className="my-8 space-y-6">{[
        { icon: MapPin, title: "Discover trusted places", body: "Browse shops, cafés and services that Akiba members visit." },
        { icon: Award, title: "Earn AkibaMiles", body: "Show your Pass when you pay at participating merchants and earn Miles." },
        { icon: Tag, title: "Use rewards where you shop", body: "Turn Miles into vouchers to use with participating merchants." },
      ].map(({ icon: Icon, title, body }) => <div key={title} className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-akiba-tint text-akiba-teal"><Icon aria-hidden="true" className="h-5 w-5" /></div><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-akiba-muted">{body}</p></div></div>)}</div>
      <button className={`${primaryClass} mt-auto`} onClick={() => go(savedUsername && country ? 2 : 1)}>Get started</button>
    </> : null}

    {step === 1 ? <form onSubmit={saveProfile} className="mt-3 space-y-5">
      <p className="text-sm leading-6 text-akiba-muted">Your username is how you appear across Akiba. Add your country and, optionally, your city.</p>
      <div><label htmlFor="onboarding-username" className="mb-2 block text-sm font-medium">Username</label><input id="onboarding-username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} value={username} disabled={!!savedUsername || busy} onChange={event => setUsername(event.target.value)} required className={inputClass} aria-describedby="username-hint" /><p id="username-hint" className="mt-2 text-xs text-akiba-muted">{savedUsername ? "Your saved username is ready to use." : "3–20 lowercase letters, numbers or underscores."}</p></div>
      <div><label htmlFor="onboarding-country" className="mb-2 block text-sm font-medium">Country</label><select id="onboarding-country" autoComplete="country-name" value={country} onChange={event => setCountry(event.target.value)} required disabled={busy} className={inputClass}><option value="" disabled>Choose your country</option>{COUNTRIES.map(value => <option key={value}>{value}</option>)}</select><p className="mt-2 text-xs text-akiba-muted">Akiba is live in Kenya for now. Offers depend on your country.</p></div>
      <div><label htmlFor="onboarding-city" className="mb-2 block text-sm font-medium">City <span className="text-akiba-muted">(optional)</span></label><input id="onboarding-city" autoComplete="address-level2" value={city} onChange={event => setCity(event.target.value)} disabled={busy} className={inputClass} placeholder="e.g. Nairobi" /></div>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy} className={primaryClass}>{busy ? "Saving…" : "Continue"}</button>
    </form> : null}

    {step === 2 ? <>
      <p className="mb-6 mt-3 text-sm leading-6 text-akiba-muted">Open your Pass at the till and let the cashier scan it when you pay.</p>
      <PassReveal passId={props.passId} displayLabel={username || props.displayLabel} />
      <div className="my-6 space-y-4"><p className="flex gap-3 text-sm text-akiba-muted"><QrCode aria-hidden="true" className="h-5 w-5 shrink-0 text-akiba-teal" />Find your QR code anytime under Pass.</p><p className="flex gap-3 text-sm text-akiba-muted"><Tag aria-hidden="true" className="h-5 w-5 shrink-0 text-akiba-teal" />Your claimed vouchers are kept under Rewards, ready to use.</p><p className="flex gap-3 text-sm text-akiba-muted"><ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-akiba-teal" />Nothing to top up. Your Pass is all you need.</p></div>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy} className={primaryClass} onClick={finish}>{busy ? "Finishing up…" : "Explore Akiba"}</button>
    </> : null}
    {step > 0 ? <button disabled={busy} className="mt-3 min-h-11 rounded-xl text-sm font-medium text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal" onClick={() => go(step - 1)}>Back</button> : null}
  </main>;
}
