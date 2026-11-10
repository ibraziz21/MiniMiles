"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QueueLoadError({
  title = "Couldn’t load reviews",
}: {
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div
      role="alert"
      className="rounded-card border border-border bg-white px-5 py-12 text-center"
    >
      <CloudOff
        className="mx-auto mb-3 h-8 w-8 text-ink-muted"
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Try again when your connection is available.
      </p>
      <Button
        className="mt-5"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Loading…" : "Try again"}
      </Button>
    </div>
  );
}
