// Open a URL in the phone's own browser instead of the in-app webview.
//
// Inside MiniPay, window.open(_blank) keeps users in MiniPay's browser.
// Android intent:// URLs ask the OS to open the link in the default browser
// (MiniPay is Android-only, so this covers it). Some webviews block intents,
// so callers should offer a copy-link fallback alongside this.

import { isMiniPayProvider } from "@/lib/minipay";

export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;

  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isMiniPayProvider() && isAndroid) {
    const u = new URL(url);
    window.location.href =
      `intent://${u.host}${u.pathname}${u.search}` +
      `#Intent;scheme=${u.protocol.replace(":", "")};action=android.intent.action.VIEW;end`;
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
