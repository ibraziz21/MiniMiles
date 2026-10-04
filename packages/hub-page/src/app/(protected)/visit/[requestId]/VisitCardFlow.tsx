"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserId } from "@/lib/browserId";
import { createClient } from "@/lib/supabase/client";
import {
  ClosedState,
  IntroStep,
  RecommendStep,
  NegativeReasonStep,
  PartySizeStep,
  ItemsStep,
  RecommendItemsStep,
  ExperienceTagsStep,
  ReviewStep,
  PhotosStep,
  SuccessStep,
  type Item,
  type PhotoUpload,
  type Step,
  type TemplateSnapshot,
} from "./steps";

// Visit-card contribution flow (verified-discovery-acquisition-v1-spec.md
// §8.3-§8.4). One focused choice per phone viewport; each answer adds to
// the same visit-card composition rather than behaving like a numbered
// survey. This component owns all state, handlers and the step sequence;
// each step's markup lives in its own file under ./steps (hardening spec
// P2 "large client components... split behind tested domain interfaces") —
// it is a pure presentational component taking only the props it needs,
// not this component's whole state.
//
// Known simplifications versus the full spec for this pass (not silently
// dropped — call these out if extending):
//  - no "You earned N Miles" figure on the intro screen (that confirmation
//    already happened via the separate earned-Miles notification; this
//    route doesn't have the Miles amount plumbed to it);
//  - the item step is free-text add, not the qualified-item combobox
//    (§8.3) — that needs a search endpoint out of scope for this pass.
const PHOTO_CONSENT_VERSION = "v1";
const MAX_ITEMS = 4;
const MAX_RECOMMENDED_ITEMS = 3;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

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
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contributionId, setContributionId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const cancelledPhotoIds = useRef(new Set<string>());

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // A member must not be able to silently abandon an in-flight browser
  // upload by closing the tab or navigating away (hardening spec §6.2):
  // either they confirm the browser's own "leave site" prompt, or the
  // upload finishes first. The in-app "Done" action has its own, separate
  // disabled-while-uploading guard below.
  const hasActiveUpload = photos.some((photo) => photo.status === "pending" || photo.status === "uploading");
  useEffect(() => {
    if (!hasActiveUpload) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveUpload]);

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
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/discovery-contributions/${requestId}/dismiss`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "We couldn't dismiss this visit. Please try again.");
        return;
      }
      router.push("/");
    } catch {
      setError("We couldn't dismiss this visit. Please try again.");
    } finally {
      setDismissing(false);
    }
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
    setPhotos((prev) => prev.map((p) => (p.localId === localId ? { ...p, status: "uploading", error: undefined } : p)));

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

      if (cancelledPhotoIds.current.has(localId)) {
        await fetch(`/api/me/discovery-contributions/${activeContributionId}/photos/${photoId}`, { method: "DELETE" });
        return;
      }

      const browserClient = createClient();
      const { error: uploadError } = await browserClient.storage
        .from(intent.bucket)
        .upload(intent.path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      if (cancelledPhotoIds.current.has(localId)) {
        await fetch(`/api/me/discovery-contributions/${activeContributionId}/photos/${photoId}`, { method: "DELETE" });
        return;
      }

      const completeRes = await fetch(
        `/api/me/discovery-contributions/${activeContributionId}/photos/${photoId}/complete`,
        { method: "POST" },
      );
      const completion = await completeRes.json().catch(() => ({}));
      if (!completeRes.ok) throw new Error(completion.error ?? "complete_failed");

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
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Photos must be 10 MB or smaller.");
      return;
    }
    if (photos.filter((p) => p.status !== "error").length >= MAX_PHOTOS) return;
    const localId = createBrowserId();
    setPhotos((prev) => [...prev, { localId, file, status: "pending" }]);
    void uploadPhoto(localId, file, contributionId);
  }

  function removePhoto(localId: string) {
    cancelledPhotoIds.current.add(localId);
    const photo = photos.find((p) => p.localId === localId);
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
    if (photo?.photoId && contributionId) {
      void fetch(`/api/me/discovery-contributions/${contributionId}/photos/${photo.photoId}`, {
        method: "DELETE",
      }).catch(() => null);
    }
  }

  function retryPhoto(localId: string) {
    const photo = photos.find((p) => p.localId === localId);
    if (!photo || !contributionId) return;
    cancelledPhotoIds.current.delete(localId);
    void uploadPhoto(localId, photo.file, contributionId);
  }

  if (alreadyExpired || alreadyClosed) {
    return <ClosedState merchantName={merchantName} headingRef={headingRef} />;
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
        <IntroStep
          merchantName={merchantName}
          onNext={goNext}
          onDismiss={dismiss}
          dismissing={dismissing}
          headingRef={headingRef}
        />
      )}

      {step === "recommend" && (
        <RecommendStep
          merchantName={merchantName}
          prompt={templateSnapshot.recommendation_prompt}
          wouldRecommend={wouldRecommend}
          onSelect={(value) => {
            setWouldRecommend(value);
            // Not goNext(): `sequence` is memoized off the current render's
            // wouldRecommend, which setWouldRecommend hasn't applied yet —
            // goNext() here would read the stale sequence and send every
            // answer to the same next step. The destination only depends on
            // the value just chosen, so decide it directly instead of
            // waiting on state.
            setStep(value === false ? "negativeReason" : "partySize");
          }}
          headingRef={headingRef}
        />
      )}

      {step === "negativeReason" && (
        <NegativeReasonStep
          options={templateSnapshot.negative_reason_options}
          negativeReasonId={negativeReasonId}
          onToggle={(id) => setNegativeReasonId(id === negativeReasonId ? null : id)}
          onSubmit={submit}
          submitting={submitting}
          headingRef={headingRef}
        />
      )}

      {step === "partySize" && (
        <PartySizeStep
          prompt={templateSnapshot.party_size_prompt}
          partySize={partySize}
          partySizeIsSixPlus={partySizeIsSixPlus}
          onSelect={(value, isSixPlus) => {
            setPartySizeIsSixPlus(isSixPlus);
            setPartySize(value);
          }}
          onBack={goBack}
          onNext={goNext}
          headingRef={headingRef}
        />
      )}

      {step === "items" && (
        <ItemsStep
          prompt={templateSnapshot.item_prompt}
          items={items}
          itemDraft={itemDraft}
          maxItems={MAX_ITEMS}
          onDraftChange={setItemDraft}
          onAdd={addItem}
          onRemove={removeItem}
          onBack={goBack}
          onNext={goNext}
          headingRef={headingRef}
        />
      )}

      {step === "recommendItems" && (
        <RecommendItemsStep
          prompt={templateSnapshot.recommendation_item_prompt}
          items={items}
          maxRecommended={MAX_RECOMMENDED_ITEMS}
          onToggle={toggleRecommendedItem}
          onBack={goBack}
          onNext={goNext}
          headingRef={headingRef}
        />
      )}

      {step === "experienceTags" && (
        <ExperienceTagsStep
          merchantName={merchantName}
          prompt={templateSnapshot.experience_prompt ?? ""}
          options={templateSnapshot.experience_options}
          maxOptions={templateSnapshot.max_experience_options}
          selectedIds={experienceOptionIds}
          onToggle={toggleExperienceOption}
          onBack={goBack}
          onNext={goNext}
          headingRef={headingRef}
        />
      )}

      {step === "review" && (
        <ReviewStep
          wouldRecommend={wouldRecommend}
          items={items}
          experienceOptionIds={experienceOptionIds}
          experienceOptions={templateSnapshot.experience_options}
          onSubmit={submit}
          submitting={submitting}
          onBack={goBack}
          headingRef={headingRef}
        />
      )}

      {step === "photos" && contributionId && (
        <PhotosStep
          prompt={templateSnapshot.photo_prompt}
          safetyGuidance={templateSnapshot.photo_safety_guidance}
          photos={photos}
          maxPhotos={MAX_PHOTOS}
          acceptedTypes={ACCEPTED_PHOTO_TYPES}
          hasActiveUpload={hasActiveUpload}
          onSelect={handlePhotoSelect}
          onRemove={removePhoto}
          onRetry={retryPhoto}
          onDone={() => setStep("success")}
          headingRef={headingRef}
        />
      )}

      {step === "success" && (
        <SuccessStep
          merchantName={merchantName}
          merchantSlug={merchantSlug}
          wouldRecommend={wouldRecommend}
          onDone={() => router.push("/")}
          headingRef={headingRef}
        />
      )}
    </main>
  );
}
