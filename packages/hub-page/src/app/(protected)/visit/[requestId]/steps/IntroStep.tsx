import type { RefObject } from "react";

export function IntroStep({
  merchantName,
  onNext,
  onDismiss,
  headingRef,
}: {
  merchantName: string;
  onNext: () => void;
  onDismiss: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
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
          onClick={onNext}
          className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
        >
          Add my visit
        </button>
        <button type="button" onClick={onDismiss} className="min-h-[44px] text-sm font-medium text-akiba-muted">
          Not now
        </button>
      </div>
    </section>
  );
}
