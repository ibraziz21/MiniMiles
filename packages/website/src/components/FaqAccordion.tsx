import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type FaqItem = { question: string; answer: string };

/**
 * Collapsed by default so a long FAQ costs one screen instead of six.
 * Built on <details>/<summary> so it needs no client JS and still opens
 * for keyboard users and for in-page search.
 */
function FaqRow({ item, tone }: { item: FaqItem; tone: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <details
      className={cn(
        "group rounded-2xl border transition",
        dark
          ? "border-white/15 bg-white/5 open:bg-white/10"
          : "border-akiba-line bg-akiba-paper open:border-akiba-teal/30 open:bg-white",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <h3
          className={cn(
            "font-sterling text-base font-medium leading-snug sm:text-lg",
            dark ? "text-white" : "text-akiba-ink",
          )}
        >
          {item.question}
        </h3>
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
            dark
              ? "bg-white/15 text-white group-open:bg-white group-open:text-akiba-ink"
              : "bg-akiba-ink text-white group-open:bg-akiba-teal",
          )}
          aria-hidden="true"
        >
          <Plus className="h-4 w-4 transition-transform duration-200 group-open:rotate-45" />
        </span>
      </summary>
      <p
        className={cn(
          "px-5 pb-5 text-sm leading-7 sm:text-base",
          dark ? "text-white/70" : "text-akiba-muted",
        )}
      >
        {item.answer}
      </p>
    </details>
  );
}

export function FaqAccordion({
  items,
  tone = "light",
  className,
}: {
  items: FaqItem[];
  tone?: "light" | "dark";
  className?: string;
}) {
  const split = Math.ceil(items.length / 2);
  const columns = [items.slice(0, split), items.slice(split)];

  return (
    <div className={cn("grid items-start gap-3 md:grid-cols-2 md:gap-4", className)}>
      {columns.map((column, index) => (
        <div key={index} className="flex flex-col gap-3 md:gap-4">
          {column.map((item) => (
            <FaqRow key={item.question} item={item} tone={tone} />
          ))}
        </div>
      ))}
    </div>
  );
}
