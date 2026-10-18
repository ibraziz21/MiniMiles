import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonLinkProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "onDark";
  size?: "sm" | "md";
  /** The circular arrow badge; off for compact chrome like the nav bar. */
  arrow?: boolean;
  className?: string;
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  arrow = true,
  className,
}: ButtonLinkProps) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const onDark = variant === "onDark";
  const classes = cn(
    "group inline-flex items-center justify-center gap-2 rounded-full font-sterling font-medium leading-none no-underline transition",
    size === "md" ? "min-h-11 px-5 py-3 text-base" : "min-h-10 px-4 py-2.5 text-sm",
    variant === "primary" && "bg-akiba-teal text-white hover:bg-[#1E7E8D] hover:text-white",
    variant === "secondary" &&
      "border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal hover:text-akiba-teal",
    variant === "ghost" && "text-akiba-ink hover:text-akiba-teal",
    onDark && "bg-white text-akiba-ink hover:bg-akiba-tint",
    className,
  );

  const badgeClass = {
    primary: "bg-white text-akiba-ink",
    secondary: "bg-akiba-tint text-akiba-teal",
    ghost: "bg-akiba-tint text-akiba-teal",
    onDark: "bg-akiba-teal text-white",
  }[variant];

  const content = (
    <>
      <span>{children}</span>
      {arrow ? (
        <span
          className={cn(
            "flex items-center justify-center rounded-full transition-transform group-hover:translate-x-0.5",
            size === "md" ? "h-7 w-7" : "h-6 w-6",
            badgeClass,
          )}
        >
          <ArrowRight className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </span>
      ) : null}
    </>
  );

  if (external) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
