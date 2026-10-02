import type { RefObject } from "react";
import type { Item } from "./types";

export function RecommendItemsStep({
  prompt,
  items,
  maxRecommended,
  onToggle,
  onBack,
  onNext,
  headingRef,
}: {
  prompt: string;
  items: Item[];
  maxRecommended: number;
  onToggle: (clientItemKey: string) => void;
  onBack: () => void;
  onNext: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {prompt}
      </h1>
      <p className="text-xs text-akiba-muted">Choose up to {maxRecommended}.</p>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <button
            key={item.clientItemKey}
            type="button"
            onClick={() => onToggle(item.clientItemKey)}
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
        <button type="button" onClick={onBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
