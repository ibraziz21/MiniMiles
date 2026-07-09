"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  QrCode,
  Wallet,
  Ticket,
  Sparkles,
  ShoppingBag,
  Lock,
  X,
} from "lucide-react";

type SheetKey = "pass" | "wallets" | "security";

type Props = {
  /** Rendered inside the "Pass" sheet (AkibaPassCard) — omit to hide the button */
  passSlot?: ReactNode;
  /** Rendered inside the "Wallets" sheet (LinkedWallets) */
  walletsSlot: ReactNode;
  /** Rendered inside the "Security" sheet (SetPasswordForm) */
  securitySlot?: ReactNode;
};

const SHEET_TITLES: Record<SheetKey, string> = {
  pass: "Your Akiba Pass",
  wallets: "Linked wallets",
  security: "Security",
};

export function ProfileQuickActions({ passSlot, walletsSlot, securitySlot }: Props) {
  const [open, setOpen] = useState<SheetKey | null>(null);

  // Lock body scroll while a sheet is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const actions: {
    key: string;
    icon: ReactNode;
    label: string;
    onClick?: () => void;
    href?: string;
  }[] = [
    ...(passSlot
      ? [{
          key: "pass",
          icon: <QrCode className="h-5 w-5 text-akiba-teal" />,
          label: "Pass",
          onClick: () => setOpen("pass"),
        }]
      : []),
    {
      key: "wallets",
      icon: <Wallet className="h-5 w-5 text-akiba-teal" />,
      label: "Wallets",
      onClick: () => setOpen("wallets"),
    },
    {
      key: "orders",
      icon: <Ticket className="h-5 w-5 text-akiba-teal" />,
      label: "Orders",
      href: "/me/orders",
    },
    {
      key: "rewards",
      icon: <Sparkles className="h-5 w-5 text-akiba-teal" />,
      label: "Rewards",
      href: "/rewards",
    },
    {
      key: "shop",
      icon: <ShoppingBag className="h-5 w-5 text-akiba-teal" />,
      label: "Shop",
      href: "/shop",
    },
    ...(securitySlot
      ? [{
          key: "security",
          icon: <Lock className="h-5 w-5 text-akiba-teal" />,
          label: "Security",
          onClick: () => setOpen("security"),
        }]
      : []),
  ];

  return (
    <>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
      >
        {actions.map(({ key, icon, label, onClick, href }) => {
          const inner = (
            <>
              {icon}
              <span className="text-[11px] font-medium text-akiba-ink">{label}</span>
            </>
          );
          const className =
            "flex w-full flex-col items-center gap-1.5 rounded-2xl border border-akiba-line bg-white px-1 py-3 text-center transition hover:border-akiba-teal/40 hover:shadow-chip";
          return href ? (
            <a key={key} href={href} className={className}>
              {inner}
            </a>
          ) : (
            <button key={key} type="button" onClick={onClick} className={className}>
              {inner}
            </button>
          );
        })}
      </div>

      {/* Bottom sheet (mobile) / centered modal (desktop) */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-4"
          role="dialog"
          aria-modal="true"
          aria-label={SHEET_TITLES[open]}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(null)}
          />
          <div className="relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-akiba-paper sm:max-w-md sm:rounded-3xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="font-sterling text-lg font-semibold text-akiba-ink">
                {SHEET_TITLES[open]}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-muted transition hover:text-akiba-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-6 sm:px-5">
              {open === "pass" ? passSlot : open === "security" ? securitySlot : walletsSlot}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
