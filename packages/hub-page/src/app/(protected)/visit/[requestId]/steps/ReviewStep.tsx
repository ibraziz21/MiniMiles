import type { RefObject } from "react";
import type { ExperienceOption, Item } from "./types";

export function ReviewStep({
  wouldRecommend,
  items,
  experienceOptionIds,
  experienceOptions,
  onSubmit,
  submitting,
  onBack,
  headingRef,
}: {
  wouldRecommend: boolean | null;
  items: Item[];
  experienceOptionIds: string[];
  experienceOptions: ExperienceOption[];
  onSubmit: () => void;
  submitting: boolean;
  onBack: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
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
              {experienceOptions
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
          onClick={onSubmit}
          disabled={submitting}
          className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Add to the Akiba guide"}
        </button>
        <button type="button" onClick={onBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
          Edit
        </button>
      </div>
    </section>
  );
}
