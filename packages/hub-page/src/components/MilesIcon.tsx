import clsx from "clsx";

/** Inline SVG of the AkibaMiles brand symbol */
export function MilesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="8" fill="#238D9D" />
      <path
        d="M6.69711 7.75901C8.26827 7.00759 9.49787 5.73245 10.2038 4.13852C9.74834 3.66034 9.15631 3.31879 8.51874 3.11385L8.17718 3C8.15441 3.04554 8.13164 3.11385 8.13164 3.1594C7.58515 4.70778 6.46941 5.96015 4.96656 6.66604C3.91912 7.16698 3.14493 8.0778 2.7806 9.17078L2.66675 9.51234C2.71229 9.53511 2.7806 9.55787 2.82614 9.55787C3.25878 9.71727 3.69142 9.9222 4.10128 10.1727C4.67054 9.14801 5.58136 8.28273 6.69711 7.75901Z"
        fill="white"
      />
      <path
        d="M12.0116 5.66675C11.1691 6.94189 10.0078 7.96656 8.5733 8.64967C7.41201 9.19616 6.52396 10.2208 6.1141 11.4504L6.00024 11.8375C6.43288 12.2246 6.9566 12.5206 7.52586 12.7028L7.86742 12.8167C7.89019 12.7711 7.91296 12.7028 7.91296 12.6573C8.45945 11.1089 9.5752 9.85651 11.078 9.15062C12.1255 8.64967 12.9224 7.73886 13.264 6.64588L13.3779 6.30432C12.8997 6.1677 12.4443 5.93999 12.0116 5.66675Z"
        fill="white"
      />
    </svg>
  );
}

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const ICON_SIZES: Record<Size, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  xl: "h-6 w-6",
};

const TEXT_SIZES: Record<Size, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
};

/**
 * Renders the AkibaMiles brand symbol followed by the formatted amount.
 * Standard format: [icon]amount (e.g.  200 or  1,500)
 */
export function MilesAmount({
  amount,
  size = "md",
  className,
  iconClassName,
  prefix = "",
}: {
  amount: number;
  size?: Size;
  className?: string;
  iconClassName?: string;
  prefix?: string;     // e.g. "+" for earned, "-" for spent
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1 font-semibold", TEXT_SIZES[size], className)}>
      <MilesIcon className={clsx(ICON_SIZES[size], iconClassName)} />
      {prefix}{amount.toLocaleString()}
    </span>
  );
}
