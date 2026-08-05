"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCircle2, ExternalLink, Loader2, Send, Users } from "lucide-react";
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

export function PushCampaignComposer({ audienceCount }: { audienceCount: number }) {
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
    if (!valid) return;
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
          : `Notifications queued for ${result.queuedCount} users.`,
      );
      setTitle("");
      setBody("");
      setDeepLink("/");
      setReviewing(false);
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch {
      setError("Network error. The campaign was not confirmed; retrying is safe.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Compose announcement</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sends only to users who enabled announcement notifications.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[#238D9D]/10 px-3 py-1.5 text-xs font-semibold text-[#176B78]">
            <Users className="h-3.5 w-3.5" />
            {audienceCount.toLocaleString()} opted in
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Announcement type
            <Select value={campaignType} onValueChange={(value) => { setCampaignType(value as PushCampaignType); edit(); }}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feature">Feature launch</SelectItem>
                <SelectItem value="merchant">New merchant</SelectItem>
                <SelectItem value="general">General update</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="text-sm font-medium text-slate-700">
            Opens in Akiba at
            <div className="relative mt-1.5">
              <Input
                value={deepLink}
                onChange={(event) => { setDeepLink(event.target.value); edit(); }}
                placeholder="/merchants/new-merchant"
                maxLength={500}
                className="pr-9 font-mono text-xs"
              />
              <ExternalLink className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>
          </label>
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Notification title
          <Input
            value={title}
            onChange={(event) => { setTitle(event.target.value); edit(); }}
            placeholder="A new way to earn Miles"
            maxLength={60}
            className="mt-1.5"
          />
          <span className="mt-1 block text-right text-xs text-slate-400">{title.length}/60</span>
        </label>

        <label className="mt-2 block text-sm font-medium text-slate-700">
          Message
          <textarea
            value={body}
            onChange={(event) => { setBody(event.target.value); edit(); }}
            placeholder="Tell members what is new and why they should open Akiba."
            maxLength={160}
            rows={4}
            className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
          />
          <span className="mt-1 block text-right text-xs text-slate-400">{body.length}/160</span>
        </label>

        {audienceCount === 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Nobody has opted into announcements on an active device yet. The send action will unlock when the audience is non-zero.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        {success && (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700" role="status">
            <CheckCircle2 className="h-4 w-4" /> {success}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!reviewing ? (
            <Button onClick={() => setReviewing(true)} disabled={!valid}>
              <BellRing className="h-4 w-4" /> Review notification
            </Button>
          ) : (
            <>
              <Button onClick={sendCampaign} disabled={sending || !valid}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? "Queueing…" : `Send to ${audienceCount.toLocaleString()} users`}
              </Button>
              <Button variant="outline" onClick={() => setReviewing(false)} disabled={sending}>Keep editing</Button>
            </>
          )}
          {reviewing && (
            <span className="text-xs font-medium text-amber-700">
              Confirm the preview and audience before sending. This cannot be recalled.
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Phone preview</p>
        <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#238D9D]">
              <BellRing className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-white">Akiba</p>
                <span className="text-[10px] text-slate-400">now</span>
              </div>
              <p className="mt-1 break-words text-sm font-semibold text-white">
                {title.trim() || TYPE_LABELS[campaignType]}
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                {body.trim() || "Your message will appear here."}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-2 text-xs text-slate-400">
          <p>Type: <span className="text-slate-200">{TYPE_LABELS[campaignType]}</span></p>
          <p>Destination: <span className="break-all font-mono text-slate-200">{deepLink || "—"}</span></p>
          <p>Delivery: <span className="text-slate-200">Queued within one minute</span></p>
        </div>
      </div>
    </div>
  );
}
