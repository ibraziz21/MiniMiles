"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserId } from "@/lib/browserId";
import { createClient } from "@/lib/supabase/client";

// Visit-card contribution flow (verified-discovery-acquisition-v1-spec.md
// §8.3-§8.4). One focused choice per phone viewport; each answer adds to
// the same visit-card composition rather than behaving like a numbered
// survey. Known simplifications versus the full spec for this pass (not
// silently dropped — call these out if extending):
//  - no "You earned N Miles" figure on the intro screen (that confirmation
//    already happened via the separate earned-Miles notification; this
//    route doesn't have the Miles amount plumbed to it);
//  - the item step is free-text add, not the qualified-item combobox
//    (§8.3) — that needs a search endpoint out of scope for this pass.
const PHOTO_CONSENT_VERSION = "v1";
const MAX_ITEMS = 4;
const MAX_RECOMMENDED_ITEMS = 3;
const MAX_PHOTOS = 3;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

type ExperienceOption = { id: string; inputLabel: string; publicLabel: string };
type NegativeReasonOption = { id: string; label: string };

type TemplateSnapshot = {
  recommendation_prompt: string;
  negative_reason_options: NegativeReasonOption[];
  party_size_prompt: string;
  item_prompt: string;
  recommendation_item_prompt: string;
  experience_prompt: string | null;
  experience_options: ExperienceOption[];
  max_experience_options: number;
  photo_prompt: string;
  photo_safety_guidance: string;
};

type Item = { clientItemKey: string; rawLabel: string; isRecommended: boolean };

type Step =
  | "intro"
  | "recommend"
  | "negativeReason"
  | "partySize"
  | "items"
  | "recommendItems"
  | "experienceTags"
  | "review"
  | "photos"
  | "success";

type PhotoUpload = {
  localId: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  photoId?: string;
  error?: string;
};

function interpolate(template: string, merchantName: string): string {
  return template.replace(/\{\{merchantName\}\}/g, merchantName);
}

export type InitialContribution = {
  wouldRecommend: boolean | null;
  negativeReasonId: string | null;
  partySize: number | null;
  partySizeIsSixPlus: boolean;
  experienceOptionIds: string[];
  items: Item[];
};

export function VisitCardFlow({
  requestId,
  merchantName,
  merchantSlug,
  templateSnapshot,
  initialState,
  expiresAt,
  initialContribution,
}: {
  requestId: string;
  merchantName: string;
  merchantSlug: string | null;
  templateSnapshot: TemplateSnapshot;
  initialState: string;
  expiresAt: string;
  initialContribution: InitialContribution | null;
}) {
  const router = useRouter();
  const alreadyExpired = new Date(expiresAt).getTime() < Date.now();
  const alreadyClosed = !["open", "submitted"].includes(initialState);

  // A previously saved contribution hydrates the flow instead of starting
  // blank — editing an existing visit card must not silently erase answers
  // the member already gave just because this submit didn't re-send them.
  const [step, setStep] = useState<Step>("intro");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(initialContribution?.wouldRecommend ?? null);
  const [negativeReasonId, setNegativeReasonId] = useState<string | null>(
    initialContribution?.negativeReasonId ?? null,
  );
  const [partySize, setPartySize] = useState<number | null>(initialContribution?.partySize ?? null);
  const [partySizeIsSixPlus, setPartySizeIsSixPlus] = useState(initialContribution?.partySizeIsSixPlus ?? false);
  const [items, setItems] = useState<Item[]>(initialContribution?.items ?? []);
  const [itemDraft, setItemDraft] = useState("");
  const [experienceOptionIds, setExperienceOptionIds] = useState<string[]>(
    initialContribution?.experienceOptionIds ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contributionId, setContributionId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Stable for the lifetime of this mount so a retry (network error, user
  // taps submit again) reuses the same key (§8.4: "A retry reuses the same
  // idempotency key"). Re-opening this route fresh after an edit mounts a
  // new instance and so gets a new key, which is correct — that's a
  // genuinely new version, not a retry.
  const [idempotencyKey] = useState(createBrowserId);

  const hasExperienceTags = Boolean(templateSnapshot.experience_prompt && templateSnapshot.experience_options.length);

  const sequence = useMemo(() => {
    const steps: Step[] = ["intro", "recommend"];
    if (wouldRecommend === false) {
      steps.push("negativeReason");
    } else if (wouldRecommend === true || wouldRecommend === null) {
      // null = not yet answered, but we still show the forward sequence so
      // the progress indicator reads sensibly before the first answer.
      steps.push("partySize", "items");
      if (wouldRecommend === true) {
        if (items.length > 0) steps.push("recommendItems");
        if (hasExperienceTags) steps.push("experienceTags");
      }
    }
    steps.push("review");
    return steps;
  }, [wouldRecommend, items.length, hasExperienceTags]);

  function goNext() {
    const currentIndex = sequence.indexOf(step);
    const next = sequence[currentIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    const currentIndex = sequence.indexOf(step);
    const prev = sequence[currentIndex - 1];
    if (prev) setStep(prev);
  }

  async function dismiss() {
    await fetch(`/api/me/discovery-contributions/${requestId}/dismiss`, { method: "POST" }).catch(() => null);
    router.push("/");
  }

  function addItem() {
    const label = itemDraft.trim().slice(0, 80);
    if (!label || items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, { clientItemKey: createBrowserId(), rawLabel: label, isRecommended: false }]);
    setItemDraft("");
  }

  function removeItem(clientItemKey: string) {
    setItems((prev) => prev.filter((item) => item.clientItemKey !== clientItemKey));
  }

  function toggleRecommendedItem(clientItemKey: string) {
    setItems((prev) => {
      const target = prev.find((item) => item.clientItemKey === clientItemKey);
      const recommendedCount = prev.filter((item) => item.isRecommended).length;
      if (target && !target.isRecommended && recommendedCount >= MAX_RECOMMENDED_ITEMS) return prev;
      return prev.map((item) =>
        item.clientItemKey === clientItemKey ? { ...item, isRecommended: !item.isRecommended } : item,
      );
    });
  }

  function toggleExperienceOption(id: string) {
    setExperienceOptionIds((prev) => {
      if (prev.includes(id)) return prev.filter((existing) => existing !== id);
      if (prev.length >= templateSnapshot.max_experience_options) return prev;
      return [...prev, id];
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/discovery-contributions/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          wouldRecommend,
          negativeReasonId,
          partySize,
          partySizeIsSixPlus,
          experienceOptionIds,
          items: wouldRecommend === false ? [] : items.map(({ clientItemKey, rawLabel, isRecommended }) => ({
            clientItemKey,
            rawLabel,
            source: "customer_input",
            isRecommended,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
        return;
      }
      setContributionId(data.contributionId ?? null);
      setStep("photos");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadPhoto(localId: string, file: File, activeContributionId: string) {
    setPhotos((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "uploading" } : p)));

    // The server already inserted an active 'uploading' row the moment the
    // intent was issued — it counts toward the 3-photo limit from that
    // point on, whether or not the upload actually succeeds. Track its id
    // as soon as we have it (not only on success) so a failure below can
    // withdraw it; otherwise a few failed uploads (a network blip, or the
    // new 10MB bucket limit rejecting a file) permanently consume photo
    // slots with no way for the member to free them.
    let photoId: string | undefined;
    try {
      const intentRes = await fetch(`/api/me/discovery-contributions/${activeContributionId}/photos/upload-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, consentVersion: PHOTO_CONSENT_VERSION }),
      });
      const intent = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok) throw new Error(intent.error ?? "upload_intent_failed");
      photoId = intent.photoId as string;
      setPhotos((prev) => prev.map((p) => (p.localId === localId ? { ...p, photoId } : p)));

      const browserClient = createClient();
      const { error: uploadError } = await browserClient.storage
        .from(intent.bucket)
        .uploadToSignedUrl(intent.path, intent.token, file);
      if (uploadError) throw new Error(uploadError.message);

      const completeRes = await fetch(
        `/api/me/discovery-contributions/${activeContributionId}/photos/${photoId}/complete`,
        { method: "POST" },
      );
      if (!completeRes.ok) throw new Error("complete_failed");

      setPhotos((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "done" } : p)));
    } catch (err) {
      if (photoId) {
        void fetch(`/api/me/discovery-contributions/${activeContributionId}/photos/${photoId}`, {
          method: "DELETE",
        }).catch(() => null);
      }
      setPhotos((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, status: "error", error: err instanceof Error ? err.message : "upload_failed" }
            : p,
        ),
      );
    }
  }

  function handlePhotoSelect(file: File | undefined) {
    if (!file || !contributionId) return;
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("Please choose a JPEG, PNG, WebP or HEIC photo.");
      return;
    }
    if (photos.filter((p) => p.status !== "error").length >= MAX_PHOTOS) return;
    const localId = createBrowserId();
    setPhotos((prev) => [...prev, { localId, file, status: "pending" }]);
    void uploadPhoto(localId, file, contributionId);
  }

  function removePhoto(localId: string) {
    const photo = photos.find((p) => p.localId === localId);
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
    if (photo?.photoId && contributionId) {
      void fetch(`/api/me/discovery-contributions/${contributionId}/photos/${photo.photoId}`, {
        method: "DELETE",
      }).catch(() => null);
    }
  }

  if (alreadyExpired || alreadyClosed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
          This invitation has closed
        </h1>
        <p className="text-sm text-akiba-muted">You can always find {merchantName} from the Akiba home page.</p>
        <Link href="/" className="rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white">
          Back to Akiba
        </Link>
      </main>
    );
  }

  const stepIndex = sequence.indexOf(step);
  const progressLabel =
    step !== "intro" && step !== "review" && step !== "photos" && step !== "success"
      ? `Your picks · ${stepIndex} of ${sequence.length - 2}`
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-6">
      {progressLabel && (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-akiba-muted" aria-live="polite">
          {progressLabel}
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {step === "intro" && (
        <section className="flex flex-1 flex-col justify-center gap-6 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-2xl font-semibold text-akiba-ink">
            Add your visit to the Akiba guide
          </h1>
          <p className="text-sm text-akiba-muted">
            Show people what to try at {merchantName} and what it&apos;s great for. Takes less than 30 seconds.
            <br />
            <span className="font-medium">Optional · Your Miles are already yours.</span>
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              Add my visit
            </button>
            <button type="button" onClick={dismiss} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Not now
            </button>
          </div>
        </section>
      )}

      {step === "recommend" && (
        <section className="flex flex-1 flex-col justify-center gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {interpolate(templateSnapshot.recommendation_prompt, merchantName)}
          </h1>
          <div className="flex flex-col gap-3">
            {(
              [
                ["Yes, I would", true],
                ["Not this time", false],
                ["Skip", null],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setWouldRecommend(value);
                  // Not goNext(): `sequence` is memoized off the current
                  // render's wouldRecommend, which setWouldRecommend hasn't
                  // applied yet — goNext() here would read the stale
                  // sequence and send every answer to the same next step.
                  // The destination only depends on the value just chosen,
                  // so decide it directly instead of waiting on state.
                  setStep(value === false ? "negativeReason" : "partySize");
                }}
                className={`min-h-[56px] rounded-2xl border px-5 py-4 text-left text-base font-medium transition ${
                  wouldRecommend === value
                    ? "border-akiba-teal bg-akiba-tint text-akiba-ink"
                    : "border-akiba-line bg-white text-akiba-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "negativeReason" && (
        <section className="flex flex-1 flex-col justify-center gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            What would help next time? <span className="font-sans text-sm font-normal text-akiba-muted">(optional, private)</span>
          </h1>
          <div className="grid grid-cols-2 gap-3">
            {templateSnapshot.negative_reason_options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setNegativeReasonId(option.id === negativeReasonId ? null : option.id)}
                className={`min-h-[44px] rounded-xl border px-4 py-3 text-sm font-medium ${
                  negativeReasonId === option.id
                    ? "border-akiba-teal bg-akiba-tint text-akiba-ink"
                    : "border-akiba-line bg-white text-akiba-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Add to the Akiba guide"}
          </button>
        </section>
      )}

      {step === "partySize" && (
        <section className="flex flex-1 flex-col justify-center gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {templateSnapshot.party_size_prompt}
          </h1>
          <p className="text-sm text-akiba-muted">Count the people whose food or items were on this bill.</p>
          <div className="grid grid-cols-3 gap-3">
            {["Just me", "2", "3", "4", "5", "6+"].map((label, index) => {
              const value = index === 0 ? 1 : index + 1;
              const isSixPlus = label === "6+";
              const selected = isSixPlus ? partySizeIsSixPlus : partySize === value && !partySizeIsSixPlus;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (isSixPlus) {
                      setPartySizeIsSixPlus(true);
                      setPartySize(null);
                    } else {
                      setPartySizeIsSixPlus(false);
                      setPartySize(value);
                    }
                  }}
                  className={`min-h-[48px] rounded-xl border text-sm font-medium ${
                    selected ? "border-akiba-teal bg-akiba-tint text-akiba-ink" : "border-akiba-line bg-white text-akiba-ink"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3">
            <button type="button" onClick={goBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "items" && (
        <section className="flex flex-1 flex-col gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {templateSnapshot.item_prompt}
          </h1>
          <div className="flex gap-2">
            <label htmlFor="item-draft" className="sr-only">
              Item name
            </label>
            <input
              id="item-draft"
              value={itemDraft}
              onChange={(event) => setItemDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addItem();
                }
              }}
              maxLength={80}
              placeholder="e.g. Spanish Latte"
              className="min-h-[44px] flex-1 rounded-xl border border-akiba-line px-4 text-base text-akiba-ink"
            />
            <button
              type="button"
              onClick={addItem}
              disabled={!itemDraft.trim() || items.length >= MAX_ITEMS}
              className="min-h-[44px] rounded-xl bg-akiba-teal px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {items.map((item) => (
              <li
                key={item.clientItemKey}
                className="flex items-center gap-2 rounded-full border border-akiba-line bg-white px-3 py-2 text-sm text-akiba-ink"
              >
                {item.rawLabel}
                <button
                  type="button"
                  onClick={() => removeItem(item.clientItemKey)}
                  aria-label={`Remove ${item.rawLabel}`}
                  className="text-akiba-muted"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-akiba-muted">Up to {MAX_ITEMS} items. You can also skip this.</p>
          <div className="mt-auto flex items-center justify-between gap-3">
            <button type="button" onClick={goBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              {items.length > 0 ? "Continue" : "Skip"}
            </button>
          </div>
        </section>
      )}

      {step === "recommendItems" && (
        <section className="flex flex-1 flex-col gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {templateSnapshot.recommendation_item_prompt}
          </h1>
          <p className="text-xs text-akiba-muted">Choose up to {MAX_RECOMMENDED_ITEMS}.</p>
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <button
                key={item.clientItemKey}
                type="button"
                onClick={() => toggleRecommendedItem(item.clientItemKey)}
                className={`min-h-[48px] rounded-xl border px-4 py-3 text-left text-sm font-medium ${
                  item.isRecommended
                    ? "border-akiba-teal bg-akiba-tint text-akiba-ink"
                    : "border-akiba-line bg-white text-akiba-ink"
                }`}
              >
                {item.rawLabel}
              </button>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3">
            <button type="button" onClick={goBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "experienceTags" && (
        <section className="flex flex-1 flex-col gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {interpolate(templateSnapshot.experience_prompt ?? "", merchantName)}
          </h1>
          <p className="text-xs text-akiba-muted">Choose up to {templateSnapshot.max_experience_options}.</p>
          <div className="flex flex-wrap gap-2">
            {templateSnapshot.experience_options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleExperienceOption(option.id)}
                className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium ${
                  experienceOptionIds.includes(option.id)
                    ? "border-akiba-teal bg-akiba-tint text-akiba-ink"
                    : "border-akiba-line bg-white text-akiba-ink"
                }`}
              >
                {option.inputLabel}
              </button>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3">
            <button type="button" onClick={goBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="flex flex-1 flex-col gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            Your visit card
          </h1>
          <dl className="flex flex-col gap-3 rounded-2xl border border-akiba-line bg-white p-4 text-sm">
            <div>
              <dt className="font-medium text-akiba-ink">Recommend</dt>
              <dd className="text-akiba-muted">
                {wouldRecommend === true ? "Yes, I would" : wouldRecommend === false ? "Not this time (private)" : "Skipped"}
              </dd>
            </div>
            {items.length > 0 && (
              <div>
                <dt className="font-medium text-akiba-ink">Picks</dt>
                <dd className="text-akiba-muted">
                  {items.map((item) => `${item.rawLabel}${item.isRecommended ? " ★" : ""}`).join(", ")}
                </dd>
              </div>
            )}
            {experienceOptionIds.length > 0 && (
              <div>
                <dt className="font-medium text-akiba-ink">Great for</dt>
                <dd className="text-akiba-muted">
                  {templateSnapshot.experience_options
                    .filter((option) => experienceOptionIds.includes(option.id))
                    .map((option) => option.publicLabel)
                    .join(", ")}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-auto flex flex-col gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Add to the Akiba guide"}
            </button>
            <button type="button" onClick={goBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Edit
            </button>
          </div>
        </section>
      )}

      {step === "photos" && contributionId && (
        <section className="flex flex-1 flex-col gap-6">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            {templateSnapshot.photo_prompt}
          </h1>
          <p className="text-xs text-akiba-muted">{templateSnapshot.photo_safety_guidance}</p>
          <div className="flex flex-wrap gap-3">
            {photos.map((photo) => (
              <div
                key={photo.localId}
                className="relative flex h-20 w-20 items-center justify-center rounded-xl border border-akiba-line bg-akiba-card text-xs text-akiba-muted"
              >
                {photo.status === "uploading" && "Uploading…"}
                {photo.status === "done" && "Added"}
                {photo.status === "error" && "Failed"}
                <button
                  type="button"
                  onClick={() => removePhoto(photo.localId)}
                  aria-label="Remove photo"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-akiba-ink shadow"
                >
                  ×
                </button>
              </div>
            ))}
            {photos.filter((p) => p.status !== "error").length < MAX_PHOTOS && (
              <label className="flex h-20 w-20 min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-dashed border-akiba-line text-xs text-akiba-muted">
                Add photo
                <input
                  type="file"
                  accept={ACCEPTED_PHOTO_TYPES.join(",")}
                  className="sr-only"
                  onChange={(event) => handlePhotoSelect(event.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setStep("success")}
              className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              Done
            </button>
          </div>
        </section>
      )}

      {step === "success" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
            Visit added. Thanks for helping people discover {merchantName}.
          </h1>
          <p className="text-sm text-akiba-muted">
            {wouldRecommend === true
              ? "Your anonymous recommendation now appears in Verified visits. Broader public insights still require enough customers to agree."
              : "Your feedback was saved. Broader public insights appear only after enough customers contribute."}
          </p>
          <div className="flex w-full flex-col gap-3">
            <Link
              href={merchantSlug ? `/merchants/${merchantSlug}#photos` : "/merchants"}
              className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
            >
              View {merchantName}
            </Link>
            <button type="button" onClick={() => router.push("/")} className="min-h-[44px] text-sm font-medium text-akiba-muted">
              Done
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
