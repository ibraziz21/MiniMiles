import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  body?: string;
  align?: "left" | "center";
  as?: "h1" | "h2";
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  body,
  align = "left",
  as = "h2",
  className,
}: SectionHeaderProps) {
  const Heading = as;

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-4",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? (
        <p className="font-sterling text-base font-medium text-akiba-teal">{eyebrow}</p>
      ) : null}
      <Heading className="font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink sm:text-5xl">
        {title}
      </Heading>
      {body ? <p className="text-lg leading-8 text-akiba-muted">{body}</p> : null}
    </div>
  );
}
