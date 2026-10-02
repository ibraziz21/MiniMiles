import type { RefObject } from "react";

export function PartySizeStep({
  prompt,
  partySize,
  partySizeIsSixPlus,
  onSelect,
  onBack,
  onNext,
  headingRef,
}: {
  prompt: string;
  partySize: number | null;
  partySizeIsSixPlus: boolean;
  onSelect: (value: number | null, isSixPlus: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {prompt}
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
              onClick={() => onSelect(isSixPlus ? null : value, isSixPlus)}
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
