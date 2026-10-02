import Link from "next/link";
import type { RefObject } from "react";

export function SuccessStep({
  merchantName,
  merchantSlug,
  wouldRecommend,
  onDone,
  headingRef,
}: {
  merchantName: string;
  merchantSlug: string | null;
  wouldRecommend: boolean | null;
  onDone: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
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
        <button type="button" onClick={onDone} className="min-h-[44px] text-sm font-medium text-akiba-muted">
          Done
        </button>
      </div>
    </section>
  );
}
