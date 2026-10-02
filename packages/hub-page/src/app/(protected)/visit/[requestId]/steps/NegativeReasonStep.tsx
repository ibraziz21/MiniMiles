import type { RefObject } from "react";
import type { NegativeReasonOption } from "./types";

export function NegativeReasonStep({
  options,
  negativeReasonId,
  onToggle,
  onSubmit,
  submitting,
  headingRef,
}: {
  options: NegativeReasonOption[];
  negativeReasonId: string | null;
  onToggle: (id: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        What would help next time? <span className="font-sans text-sm font-normal text-akiba-muted">(optional, private)</span>
      </h1>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
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
        onClick={onSubmit}
        disabled={submitting}
        className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {submitting ? "Saving…" : "Add to the Akiba guide"}
      </button>
    </section>
  );
}
