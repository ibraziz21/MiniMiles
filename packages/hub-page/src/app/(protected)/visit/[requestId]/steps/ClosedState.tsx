import Link from "next/link";
import type { RefObject } from "react";

export function ClosedState({ merchantName, headingRef }: { merchantName: string; headingRef: RefObject<HTMLHeadingElement> }) {
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
