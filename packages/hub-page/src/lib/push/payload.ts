import type { RenderedNotification } from "./templates";

export interface PushPayload {
  v: 1;
  notificationId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  category: string;
}

export function buildPushPayload(
  notificationId: string,
  category: string,
  deepLink: string,
  rendered: RenderedNotification
): PushPayload {
  return {
    v: 1,
    notificationId,
    title: rendered.title,
    body: rendered.body,
    url: deepLink,
    tag: `notification:${notificationId}`,
    category,
  };
}
