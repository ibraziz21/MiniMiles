"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PushCampaignType } from "@/lib/pushCampaigns";

const TYPE_LABELS: Record<PushCampaignType, string> = {
  feature: "Feature launch",
  merchant: "New merchant",
  general: "General update",
};

export function PushCampaignComposer({
  audienceCount,
}: {
  audienceCount: number;
}) {
  const lock = useRef(false);
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [campaignType, setCampaignType] = useState<PushCampaignType>("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deepLink, setDeepLink] = useState("/");
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const valid =
    title.trim().length > 0 &&
    title.trim().length <= 60 &&
    body.trim().length > 0 &&
    body.trim().length <= 160 &&
    deepLink.startsWith("/") &&
    !deepLink.startsWith("//") &&
    audienceCount > 0;

  function edit() {
    setReviewing(false);
    setError(null);
    setSuccess(null);
  }

  async function sendCampaign() {
    if (!valid || lock.current) return;
    lock.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/push-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignType,
          title,
          body,
          deepLink,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Failed to queue campaign");
        return;
      }

      setSuccess(
        result.queuedCount === 1
          ? "Notification queued for 1 user."
          : `Notifications queued for ${result.queuedCount} users.`
      );
      setTitle("");
      setBody("");
      setDeepLink("/");
      setReviewing(false);
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch {
      setError(
        "Network error. The campaign was not confirmed; retrying is safe."
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  }

  const preview = (
    <section className="rounded-card bg-[#EAEDFF] p-5">
      <p className="text-sm font-medium text-primary">Akiba · Preview</p>
      <h3 className="mt-3 break-words font-semibold">
        {title || "Notification title"}
      </h3>
      <p className="mt-2 break-words text-sm leading-6 text-ink-muted">
        {body || "Your message appears here."}
      </p>
    </section>
  );
  if (success)
    return (
      <section className="mx-auto max-w-xl space-y-5 py-12 text-center">
        <CheckCircle2
          className="mx-auto h-16 w-16 text-primary"
          aria-hidden="true"
        />
        <h2 className="text-3xl font-semibold">Notification queued</h2>
        <p role="status" className="text-sm text-ink-muted">
          {success}
        </p>
        <p className="text-sm text-ink-muted">
          Queueing does not confirm delivery to a device.
        </p>
        <Button className="min-h-12 w-full" onClick={() => setSuccess(null)}>
          Compose another
        </Button>
        <a
          href="/push-notifications"
          className="flex min-h-11 items-center justify-center text-primary"
        >
          Back to notifications
        </a>
      </section>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h2 className="text-2xl font-semibold">
        {reviewing ? "Review and send" : "Compose notification"}
      </h2>
      {reviewing ? (
        <>
          {preview}
          <section className="space-y-4 rounded-card bg-white p-5 text-sm">
            <p>
              Audience:{" "}
              <strong>{audienceCount.toLocaleString()} opted-in users</strong>
            </p>
            <p className="break-all">Destination: {deepLink}</p>
            <p>Send time: Immediate</p>
          </section>
          <p className="text-sm text-ink-muted">
            Confirm the message and audience. This cannot be recalled.
          </p>
        </>
      ) : (
        <>
          <div className="rounded-card bg-white p-4 text-sm">
            Audience: {audienceCount.toLocaleString()} opted-in users
          </div>
          <label className="block text-sm font-medium">
            Announcement type
            <select
              value={campaignType}
              onChange={(e) =>
                setCampaignType(e.target.value as PushCampaignType)
              }
              className="mt-2 min-h-12 w-full rounded-control border-0 bg-white px-3 text-base"
            >
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Notification title{" "}
            <span className="float-right text-xs text-ink-muted">
              {title.length}/60
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              className="mt-2 min-h-12 border-0 bg-white text-base"
            />
          </label>
          <label className="block text-sm font-medium">
            Message{" "}
            <span className="float-right text-xs text-ink-muted">
              {body.length}/160
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={160}
              rows={4}
              className="mt-2 w-full rounded-card border-0 bg-white p-4 text-base focus-visible:outline-primary"
            />
          </label>
          <label className="block text-sm font-medium">
            Destination in Akiba
            <Input
              value={deepLink}
              onChange={(e) => setDeepLink(e.target.value)}
              maxLength={500}
              className="mt-2 min-h-12 border-0 bg-white text-base"
            />
            <span className="mt-1 block text-xs text-ink-muted">
              Relative app path, e.g. /merchants
            </span>
          </label>
          {preview}
        </>
      )}
      {!audienceCount && (
        <p className="text-sm text-ink-muted">
          No active opted-in users are available.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        className="min-h-12 w-full"
        disabled={!valid || sending}
        onClick={() => (reviewing ? void sendCampaign() : setReviewing(true))}
      >
        {sending ? "Queueing…" : reviewing ? "Send notification" : "Review"}
      </Button>
      {reviewing && (
        <Button
          className="min-h-12 w-full bg-[#EAEDFF]"
          variant="secondary"
          disabled={sending}
          onClick={() => setReviewing(false)}
        >
          Back to edit
        </Button>
      )}
    </div>
  );
}
