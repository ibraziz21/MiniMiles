import webpush from "web-push";

let configured = false;

export function getWebPushClient() {
  if (!configured) {
    const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
      throw new Error("WEB_PUSH_VAPID_CONFIG_MISSING");
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return webpush;
}

export function vapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY &&
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY &&
      process.env.WEB_PUSH_VAPID_SUBJECT
  );
}
