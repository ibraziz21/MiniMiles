"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Share } from "lucide-react";
import {
  isPushSupported,
  isIos,
  isIosStandalone,
  subscribeDevice,
  unsubscribeDevice,
} from "@/lib/push/browser";

type PushInfo = {
  vapid_public_key: string | null;
  preferences: { orders: boolean; vouchers: boolean; rewards: boolean; marketing: boolean };
};

type ViewState =
  | "loading"
  | "unsupported"
  | "ios_not_installed"
  | "permission_default"
  | "granted_unsubscribed"
  | "granted_subscribed"
  | "denied";

export function PushNotificationSettings() {
  const [state, setState] = useState<ViewState>("loading");
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    if (isIos() && !isIosStandalone()) {
      setState("ios_not_installed");
      return;
    }

    const permission = Notification.permission;
    if (permission === "denied") {
      setState("denied");
      return;
    }

    const res = await fetch("/api/me/push");
    const data = (await res.json()) as PushInfo;
    setInfo(data);

    if (permission === "default") {
      setState("permission_default");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    setState(subscription ? "granted_subscribed" : "granted_unsubscribed");
  }

  useEffect(() => {
    refresh().catch(() => setState("unsupported"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    if (!info?.vapid_public_key) {
      setError("Push isn't configured yet. Try again later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await subscribeDevice(info.vapid_public_key);
      await refresh();
    } catch {
      setError("Couldn't enable notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      await unsubscribeDevice();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePreference(key: "orders" | "vouchers" | "rewards", value: boolean) {
    if (!info) return;
    setInfo({ ...info, preferences: { ...info.preferences, [key]: value } });
    await fetch("/api/me/push/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
  }

  if (state === "loading") return null;

  const card = (children: React.ReactNode) => (
    <div className="rounded-2xl border border-akiba-line bg-white p-4">{children}</div>
  );

  if (state === "unsupported") {
    return card(
      <p className="text-sm text-akiba-muted">Notifications aren&apos;t supported by this browser.</p>
    );
  }

  if (state === "ios_not_installed") {
    return card(
      <div className="flex items-start gap-3">
        <Share className="mt-0.5 h-4 w-4 shrink-0 text-akiba-teal" />
        <p className="text-sm text-akiba-muted">
          Add Akiba to your Home Screen to enable notifications: tap the Share icon in Safari, then
          &quot;Add to Home Screen&quot;. Open Akiba from your Home Screen afterwards.
        </p>
      </div>
    );
  }

  if (state === "denied") {
    return card(
      <div className="flex items-start gap-3">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-akiba-muted" />
        <p className="text-sm text-akiba-muted">
          Notifications are blocked for Akiba in your device settings. Enable them there to receive order
          and voucher updates.
        </p>
      </div>
    );
  }

  if (state === "permission_default") {
    return card(
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-akiba-ink">Stay updated</p>
          <p className="text-sm text-akiba-muted">
            Get notified about order and voucher updates, even when Akiba is closed.
          </p>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
        <button
          onClick={handleEnable}
          disabled={busy}
          className="shrink-0 rounded-xl bg-akiba-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Enable notifications
        </button>
      </div>
    );
  }

  if (state === "granted_unsubscribed") {
    return card(
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-akiba-ink">Turn on notifications for this device</p>
        <button
          onClick={handleEnable}
          disabled={busy}
          className="shrink-0 rounded-xl bg-akiba-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Turn on
        </button>
      </div>
    );
  }

  // granted_subscribed
  return card(
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-akiba-teal" />
          <p className="font-medium text-akiba-ink">Notifications on</p>
        </div>
        <button
          onClick={handleDisable}
          disabled={busy}
          className="text-xs font-medium text-akiba-muted hover:text-akiba-ink disabled:opacity-60"
        >
          Turn off on this device
        </button>
      </div>

      {info && (
        <div className="space-y-2 border-t border-akiba-line pt-3">
          <label className="flex items-center justify-between text-sm text-akiba-ink">
            Orders &amp; refunds
            <input
              type="checkbox"
              checked={info.preferences.orders}
              onChange={(e) => handleTogglePreference("orders", e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between text-sm text-akiba-ink">
            Vouchers
            <input
              type="checkbox"
              checked={info.preferences.vouchers}
              onChange={(e) => handleTogglePreference("vouchers", e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between text-sm text-akiba-ink">
            Referral rewards
            <input
              type="checkbox"
              checked={info.preferences.rewards}
              onChange={(e) => handleTogglePreference("rewards", e.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
