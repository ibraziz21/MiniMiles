import type { RefObject } from "react";
import { interpolate } from "./types";

export function RecommendStep({
  merchantName,
  prompt,
  wouldRecommend,
  onSelect,
  headingRef,
}: {
  merchantName: string;
  prompt: string;
  wouldRecommend: boolean | null;
  onSelect: (value: boolean | null) => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {interpolate(prompt, merchantName)}
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
            onClick={() => onSelect(value)}
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
  );
}
