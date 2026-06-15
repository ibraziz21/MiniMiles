import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonLinkProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  external?: boolean;
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
  external,
}: ButtonLinkProps) {
  const isExternal = external ?? (href.startsWith("http") || href.startsWith("mailto:"));

  const classes = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 font-sterling text-base font-medium leading-none no-underline transition",
    variant === "primary" &&
      "bg-akiba-teal text-white hover:bg-[#1E7E8D] hover:text-white",
    variant === "secondary" &&
      "border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal hover:text-akiba-teal",
    variant === "ghost" && "text-akiba-ink hover:text-akiba-teal",
    className,
  );

  const content = (
    <>
      <span>{children}</span>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-current">
        <ArrowRight className="h-4 w-4" />
      </span>
    </>
  );

  if (isExternal) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer">
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
