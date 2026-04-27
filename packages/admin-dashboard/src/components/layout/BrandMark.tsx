import * as React from "react";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="16" cy="16" r="14" fill="#238D9D" opacity="0.15" />
      <circle cx="16" cy="16" r="9" fill="#238D9D" opacity="0.3" />
      <circle cx="16" cy="16" r="5" fill="#238D9D" />
      <path
        d="M16 8 L18.5 13.5 L24 14.5 L20 18.5 L21 24 L16 21.5 L11 24 L12 18.5 L8 14.5 L13.5 13.5 Z"
        fill="white"
        opacity="0.9"
      />
    </svg>
  );
}
