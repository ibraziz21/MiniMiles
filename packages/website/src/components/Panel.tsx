import { cn } from "@/lib/utils";

type Tone = "white" | "paper" | "card" | "tint" | "ink" | "teal" | "wash";

const toneClass: Record<Tone, string> = {
  white: "bg-white",
  paper: "bg-akiba-paper",
  card: "bg-akiba-card",
  tint: "bg-akiba-tint",
  ink: "ink-band text-white",
  teal: "teal-band text-white",
  wash: "hero-wash wash-grid",
};

type PanelProps = {
  id?: string;
  tone?: Tone;
  /** Drops the default inner padding when the panel lays out its own grid. */
  bare?: boolean;
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
};

/**
 * Every major section is an inset rounded card floating on the paper page,
 * with a consistent gutter. Panels clip their own content, so a phone
 * mockup can bleed off the edge and be cut by the card instead of the
 * viewport.
 */
export function Panel({
  id,
  tone = "white",
  bare = false,
  className,
  innerClassName,
  children,
}: PanelProps) {
  return (
    <section id={id} className={cn("scroll-mt-28 px-3 pb-3 sm:px-5 sm:pb-5", className)}>
      <div
        className={cn(
          "relative mx-auto w-full max-w-[84rem] overflow-hidden rounded-[1.75rem] sm:rounded-[2.25rem]",
          toneClass[tone],
          !bare && "px-5 py-14 sm:px-10 sm:py-16 lg:px-14 lg:py-20",
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
