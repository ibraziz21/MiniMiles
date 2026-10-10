"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronRight, Landmark, Loader2, Search, Send, ShieldCheck, Store, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, minorToMajor } from "@/lib/utils";

export interface GrantAllocationOption {
  id: string;
  fundId: string;
  fundName: string;
  merchantName: string;
  title: string;
  discountKes: number;
  minimumSpendKes: number;
  maximumReimbursementMinor: number;
  currency: string;
  expiresAt: string;
  quantityRemaining: number;
  availableBudgetMinor: number;
}

interface MemberResult {
  id: string;
  username: string;
  maskedContact: string;
  joinedAt: string | null;
}

interface PreviewResult {
  eligible: boolean;
  requirements: Array<{ label: string; satisfied: boolean }>;
  message: string;
  code?: string;
}

const STEPS = ["Member", "Voucher", "Review"] as const;

export function IssueVoucherFlow({ allocations, enabled }: { allocations: GrantAllocationOption[]; enabled: boolean }) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberResult[]>([]);
  const [member, setMember] = useState<MemberResult | null>(null);
  const [allocationId, setAllocationId] = useState("");
  const [reason, setReason] = useState("");
  const [searching, setSearching] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allocation = useMemo(() => allocations.find((item) => item.id === allocationId) ?? null, [allocationId, allocations]);
  const currentStep = preview ? 3 : member ? 2 : 1;

  useEffect(() => {
    if (query.trim().length < 2 || member) {
      setMembers([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/voucher-grants/members?query=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Member search failed.");
        setMembers(body.members ?? []);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") setError((searchError as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query, member]);

  async function checkEligibility() {
    if (!member || !allocation) return;
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch("/api/admin/voucher-grants/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id, allocation_id: allocation.id }),
      });
      const body = await response.json();
      if (!response.ok && !body.preview) throw new Error(body.error ?? "Eligibility preview failed.");
      setPreview(body.preview ?? body);
    } catch (previewError) {
      setError((previewError as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  function resetMember() {
    setMember(null);
    setQuery("");
    setAllocationId("");
    setPreview(null);
    setReason("");
  }

  if (!enabled) {
    return (
      <Card className="mx-auto max-w-3xl border-warning/25 bg-warning/[0.04] p-5 shadow-none sm:p-6">
        <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" /><div><h2 className="font-semibold text-ink">Issuance is currently paused</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Enable the funded-voucher admin feature only after the Platform grant and eligibility controls are ready.</p></div></div>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <nav aria-label="Issue voucher progress" className="grid grid-cols-3 overflow-hidden rounded-card border border-border bg-surface">
        {STEPS.map((label, index) => {
          const step = index + 1;
          const complete = step < currentStep;
          const active = step === currentStep;
          return (
            <div key={label} aria-current={active ? "step" : undefined} className={cn("flex min-h-[52px] items-center justify-center gap-2 border-r border-border px-2 text-xs font-medium last:border-r-0 sm:text-sm", active ? "bg-primary/[0.06] text-primary-strong" : complete ? "text-success" : "text-ink-muted")}>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold", active && "border-primary bg-primary text-white", complete && "border-success bg-success text-white")}>
                {complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step}
              </span>
              {label}
            </div>
          );
        })}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Card className="overflow-hidden border-border shadow-[0_18px_48px_-34px_rgba(15,23,42,0.5)]">
          <div className="border-b border-border px-4 py-4 sm:px-5"><h2 className="font-semibold text-ink">1. Select a member</h2><p className="mt-1 text-sm text-ink-muted">Search by username, phone, wallet address, or member ID.</p></div>
          <div className="p-4 sm:p-5">
            {member ? (
              <div className="flex items-center gap-3 rounded-card border border-success/25 bg-success/[0.04] p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success"><UserRound className="h-5 w-5" aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">@{member.username}</p><p className="text-xs text-ink-muted">{member.maskedContact}</p></div>
                <Button type="button" variant="ghost" size="sm" onClick={resetMember}>Change</Button>
              </div>
            ) : (
              <div>
                <label htmlFor="member-search" className="text-sm font-medium text-ink">Member search</label>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input id="member-search" name="member-search" type="search" autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. awino, +254…, 0x…" className="min-h-11 w-full rounded-control border border-border bg-surface pl-9 pr-10 text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm" />
                  {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" aria-label="Searching" />}
                </div>
                {query.trim().length > 0 && query.trim().length < 2 && <p className="mt-2 text-xs text-ink-muted">Enter at least two characters.</p>}
                {members.length > 0 && (
                  <ul className="mt-2 overflow-hidden rounded-card border border-border">
                    {members.map((result) => (
                      <li key={result.id} className="border-b border-border last:border-b-0"><button type="button" onClick={() => { setMember(result); setMembers([]); setPreview(null); }} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UserRound className="h-4 w-4 text-ink-muted" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">@{result.username}</span><span className="block text-xs text-ink-muted">{result.maskedContact}</span></span><ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></button></li>
                    ))}
                  </ul>
                )}
                {!searching && query.trim().length >= 2 && members.length === 0 && !error && <p className="mt-3 text-sm text-ink-muted">No matching members.</p>}
              </div>
            )}
          </div>

          <div className={cn("border-t border-border px-4 py-4 sm:px-5", !member && "opacity-50")}>
            <h2 className="font-semibold text-ink">2. Select a reimbursable voucher</h2>
            <p className="mt-1 text-sm text-ink-muted">Only live allocations configured for direct issue appear.</p>
            <label htmlFor="allocation" className="sr-only">Voucher allocation</label>
            <select id="allocation" name="allocation" autoComplete="off" value={allocationId} onChange={(event) => { setAllocationId(event.target.value); setPreview(null); }} disabled={!member} className="mt-3 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed sm:text-sm">
              <option value="">Choose an allocation</option>
              {allocations.map((option) => <option key={option.id} value={option.id}>{option.title} · {option.merchantName} · {option.quantityRemaining} left</option>)}
            </select>
            {member && allocations.length === 0 && <p className="mt-3 rounded-control bg-warning/[0.06] p-3 text-sm text-warning">No live allocations currently allow direct issuance.</p>}
            <Button type="button" onClick={checkEligibility} disabled={!member || !allocation || previewing} className="mt-4 min-h-11 w-full sm:w-auto">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}Check eligibility
            </Button>
          </div>

          {preview && (
            <div className="border-t border-border px-4 py-4 sm:px-5">
              <h2 className="font-semibold text-ink">3. Review and confirm</h2>
              <div className={cn("mt-3 rounded-card border p-4", preview.eligible ? "border-success/25 bg-success/[0.04]" : "border-warning/25 bg-warning/[0.04]")}>
                <div className="flex gap-3"><ShieldCheck className={cn("mt-0.5 h-5 w-5 shrink-0", preview.eligible ? "text-success" : "text-warning")} aria-hidden="true" /><div><p className="text-sm font-semibold text-ink">{preview.eligible ? "Eligible to issue" : "Issuance not available"}</p><p className="mt-1 text-sm leading-6 text-ink-muted">{preview.message}</p></div></div>
                <ul className="mt-3 space-y-2 border-t border-current/10 pt-3">
                  {preview.requirements.map((requirement) => <li key={requirement.label} className="flex items-center gap-2 text-sm text-ink"><span className={cn("flex h-5 w-5 items-center justify-center rounded-full", requirement.satisfied ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{requirement.satisfied ? <Check className="h-3 w-3" aria-hidden="true" /> : <AlertCircle className="h-3 w-3" aria-hidden="true" />}</span>{requirement.label}</li>)}
                </ul>
              </div>
              <label htmlFor="issue-reason" className="mt-4 block text-sm font-medium text-ink">Operator reason</label>
              <textarea id="issue-reason" name="issue-reason" autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} disabled={!preview.eligible} placeholder="e.g. Service recovery for delayed claim…" className="mt-2 w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-surface-subtle sm:text-sm" />
              <Button type="button" disabled={!preview.eligible || reason.trim().length < 4} className="mt-4 min-h-11 w-full sm:w-auto"><Send className="h-4 w-4" aria-hidden="true" />Issue voucher</Button>
            </div>
          )}

          {error && <div role="alert" className="border-t border-danger/20 bg-danger/[0.04] px-4 py-3 text-sm text-danger sm:px-5">{error}</div>}
        </Card>

        <aside className="space-y-4">
          <Card className="border-border p-4 shadow-none sm:p-5">
            <h2 className="text-sm font-semibold text-ink">Issue summary</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Recipient</dt><dd className="max-w-[60%] truncate font-medium text-ink">{member ? `@${member.username}` : "Not selected"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Merchant</dt><dd className="max-w-[60%] text-right font-medium text-ink">{allocation?.merchantName ?? "Not selected"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Benefit</dt><dd className="font-medium text-ink">{allocation ? formatMoney(allocation.discountKes, allocation.currency) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Max reimbursement</dt><dd className="font-medium text-ink">{allocation ? formatMoney(minorToMajor(allocation.maximumReimbursementMinor), allocation.currency) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Allocation closes</dt><dd className="font-medium text-ink">{allocation ? new Date(allocation.expiresAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"}</dd></div>
            </dl>
          </Card>
          <Card className="border-primary/15 bg-primary/[0.04] p-4 shadow-none sm:p-5">
            <div className="flex gap-3"><Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="text-sm font-semibold text-ink">Budget-safe by design</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Eligibility and availability are rechecked by the Platform at confirmation. Operators cannot bypass member rules or fund limits.</p></div></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
