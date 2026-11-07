"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";

import { isAndroid, isIos, isStandaloneApp } from "@/lib/push/browser";
import { APP_INSTALL_DISMISS_KEY, wasRecentlyDismissed } from "@/lib/mobile/installPrompt";
import { APP_DOWNLOAD_URL } from "@/constants/links";
import { TrackedAnchor } from "@/components/TrackedAnchor";

export function InstallPrompt() {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (pathname === "/welcome" || isStandaloneApp()) return;
    const device = isIos() ? "ios" : isAndroid() ? "android" : "desktop";
    setPlatform(device);
    try {
      if (wasRecentlyDismissed(localStorage.getItem(APP_INSTALL_DISMISS_KEY)) ||
          wasRecentlyDismissed(localStorage.getItem("akiba_install_dismissed_v1"))) return;
    } catch { /* Storage may be unavailable. */ }
    setVisible(true);
  }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, [visible]);

  function dismiss() {
    try { localStorage.setItem(APP_INSTALL_DISMISS_KEY, String(Date.now())); } catch { /* Dismiss for this visit even without storage. */ }
    window.dispatchEvent(new Event("akiba:app-install-dismissed"));
    setVisible(false);
  }

  if (!visible) return null;

  const buttonClass = "flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-akiba-teal px-5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akiba-teal";

  return (
    <dialog
      ref={dialog}
      aria-labelledby="install-app-title"
      aria-describedby="install-app-description"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-[2rem] border-0 bg-transparent p-0 text-akiba-ink backdrop:bg-black/45 sm:inset-0 sm:m-auto sm:max-w-md sm:rounded-[2rem]"
    >
      <div className="relative bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 sm:p-8">
        <button autoFocus onClick={dismiss} aria-label="Close install prompt" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-akiba-muted hover:bg-akiba-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-akiba-teal">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-akiba-teal/10 text-akiba-teal">
          <Download className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 id="install-app-title" className="font-sterling text-2xl font-semibold">Take Akiba with you</h2>
        <p id="install-app-description" className="mb-6 mt-3 text-base leading-relaxed text-akiba-muted">Discover local places, find offers and keep your rewards close. Get the Akiba app on iOS and Android.</p>
        <TrackedAnchor href={APP_DOWNLOAD_URL} event="app_install_tap" eventProps={{ slot: "install_sheet", platform }} className={buttonClass}>Install now</TrackedAnchor>
        {platform !== "desktop" && (
          <p className="mt-3 text-center text-xs text-akiba-muted">{platform === "ios" ? "Download on the App Store" : "Get it on Google Play"}</p>
        )}
        <button onClick={dismiss} className="mt-3 min-h-11 w-full rounded-full text-sm font-medium text-akiba-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-akiba-teal">Maybe later</button>
      </div>
    </dialog>
  );
}
