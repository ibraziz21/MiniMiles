"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/** small className join helper (no deps) */
function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

type ResponsiveOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;

  /** Optional class overrides */
  mobileSheetClassName?: string;
  desktopDialogClassName?: string;

  /** Tailwind breakpoint for “desktop” behavior */
  desktopMinWidthPx?: number; // default 768 (md)
};

function useIsDesktop(minWidthPx: number) {
  const [isDesktop, setIsDesktop] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidthPx}px)`);

    const sync = () => setIsDesktop(mq.matches);
    sync();

    // Safari support
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync);
      else mq.removeListener(sync);
    };
  }, [minWidthPx]);

  return isDesktop;
}

export function ResponsiveOverlay({
  open,
  onOpenChange,
  children,
  mobileSheetClassName,
  desktopDialogClassName,
  desktopMinWidthPx = 768,
}: ResponsiveOverlayProps) {
  const isDesktop = useIsDesktop(desktopMinWidthPx);

  // IMPORTANT: Render only ONE overlay at a time (prevents double UI on desktop)
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cx(
            // desktop-centered modal defaults
            "font-sterling bg-white",
            "w-[92vw] max-w-[560px]",
            "rounded-[20px]",
            "p-0",
            "border-none",
            "shadow-[0_20px_60px_rgba(0,0,0,0.25)]",
            "data-[state=open]:animate-none",
            desktopDialogClassName
          )}
        >
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  // Mobile bottom sheet
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cx(
          "font-sterling bg-white",
          "max-h-[90vh] overflow-auto",
          "rounded-t-[24px]",
          "p-0",
          "border-none",
          "shadow-[0_-10px_30px_rgba(0,0,0,0.15)]",
          "data-[state=open]:animate-none",
          mobileSheetClassName
        )}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}
