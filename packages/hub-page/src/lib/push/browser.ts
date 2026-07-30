const INSTALLATION_ID_KEY = "akiba:push:installation_id";

export type Platform = "ios" | "android" | "desktop" | "unknown";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isIosStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ("standalone" in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone)) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/win|mac|linux/i.test(ua)) return "desktop";
  return "unknown";
}

export function getOrCreateInstallationId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(INSTALLATION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(INSTALLATION_ID_KEY, id);
  }
  return id;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64Safe);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function postSubscription(subscription: PushSubscription) {
  const res = await fetch("/api/me/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installation_id: getOrCreateInstallationId(),
      platform: detectPlatform(),
      subscription: subscription.toJSON(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Push registration failed (${res.status})`);
  }
}

export async function subscribeDevice(vapidPublicKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(`PERMISSION_${permission.toUpperCase()}`);
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });

  await postSubscription(subscription);
}

export async function resubscribeIfNeeded(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await postSubscription(subscription);
    }
  } catch {
    // Best-effort only; never surface an error to the user for this.
  }
}

export async function unsubscribeDevice(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await fetch("/api/me/push/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } catch {
      // Continue to unsubscribe locally even if the server call failed.
    }

    await subscription.unsubscribe();
  } catch {
    // Never block the caller (e.g. logout) on push cleanup failures.
  }
}

export async function cleanupPushBeforeLogout(): Promise<void> {
  await unsubscribeDevice();
}
