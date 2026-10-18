import { Eyebrow } from "@/components/Eyebrow";
import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  body?: string;
  align?: "left" | "center";
  as?: "h1" | "h2";
  tone?: "default" | "onDark";
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  body,
  align = "left",
  as = "h2",
  tone = "default",
  className,
}: SectionHeaderProps) {
  const Heading = as;
  const dark = tone === "onDark";

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-5",
        align === "center" && "mx-auto items-center text-center",
        className,
      )}
    >
      {eyebrow ? (
        <Eyebrow tone={dark ? "onDark" : "default"} className={align === "left" ? "self-start" : undefined}>
          {eyebrow}
        </Eyebrow>
      ) : null}
      <Heading
        className={cn(
          "font-sterling text-[2.5rem] font-medium leading-[1.04] tracking-[-0.015em] sm:text-5xl",
          dark ? "text-white" : "text-akiba-ink",
        )}
      >
        {title}
      </Heading>
      {body ? (
        <p className={cn("text-lg leading-8", dark ? "text-white/70" : "text-akiba-muted")}>
          {body}
        </p>
      ) : null}
    </div>
  );
}
