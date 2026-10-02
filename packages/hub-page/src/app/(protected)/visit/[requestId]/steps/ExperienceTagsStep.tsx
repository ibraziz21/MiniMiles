import type { RefObject } from "react";
import type { ExperienceOption } from "./types";
import { interpolate } from "./types";

export function ExperienceTagsStep({
  merchantName,
  prompt,
  options,
  maxOptions,
  selectedIds,
  onToggle,
  onBack,
  onNext,
  headingRef,
}: {
  merchantName: string;
  prompt: string;
  options: ExperienceOption[];
  maxOptions: number;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {interpolate(prompt, merchantName)}
      </h1>
      <p className="text-xs text-akiba-muted">Choose up to {maxOptions}.</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium ${
              selectedIds.includes(option.id)
                ? "border-akiba-teal bg-akiba-tint text-akiba-ink"
                : "border-akiba-line bg-white text-akiba-ink"
            }`}
          >
            {option.inputLabel}
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
