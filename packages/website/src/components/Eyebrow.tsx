import { cn } from "@/lib/utils";

type EyebrowProps = {
  children: React.ReactNode;
  /** "onDark" is for the teal and ink panels. */
  tone?: "default" | "onDark";
  className?: string;
};

/** Small capsule that labels a section, in place of a plain coloured line. */
export function Eyebrow({ children, tone = "default", className }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold",
        tone === "onDark"
          ? "border-white/25 bg-white/10 text-white"
          : "border-akiba-line bg-white text-akiba-teal",
        className,
      )}
    >
      {children}
    </span>
  );
}
