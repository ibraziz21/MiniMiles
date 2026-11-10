"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { VoucherFacts, voucherCard } from "./VoucherUi";
import { voucherDateTime } from "@/lib/voucherPresentation";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, minorToMajor } from "@/lib/utils";

export interface GrantAllocationOption {
  id: string;
  fundId: string;
  fundName: string;
  merchantName: string;
  title: string;
  /** Pre-formatted by allocationBenefitLabel — a percentage allocation has no
   *  single KES amount to render here. */
  benefitLabel: string;
  minimumSpendKes: number;
  maximumReimbursementMinor: number;
  currency: string;
  expiresAt: string;
  quantityRemaining: number;
  voucherValiditySeconds?: number | null;
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

interface IssuedVoucherResult {
  id: string;
  status: string;
  expiresAt: string;
  idempotent: boolean;
  recipient: string;
  merchantName: string;
  fundName: string;
  fundId: string | null;
  auditReference: string;
}

export function IssueVoucherFlow({
  allocations,
}: {
  allocations: GrantAllocationOption[];
}) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberResult[]>([]);
  const [member, setMember] = useState<MemberResult | null>(null);
  const [allocationId, setAllocationId] = useState("");
  const [reason, setReason] = useState("");
  const [searching, setSearching] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedVoucherResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allocation = useMemo(
    () => allocations.find((item) => item.id === allocationId) ?? null,
    [allocationId, allocations]
  );
  const [currentStep, setCurrentStep] = useState(1);
  const requestLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    heading.current?.focus();
  }, [currentStep, issued]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMembers([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/voucher-grants/members?query=${encodeURIComponent(
            query.trim()
          )}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Member search failed.");
        setMembers(body.members ?? []);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError")
          setError((searchError as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  async function checkEligibility() {
    if (!member || !allocation || requestLock.current) return;
    requestLock.current = true;
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch("/api/admin/voucher-grants/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_username: member.username,
          allocation_id: allocation.id,
        }),
      });
      const body = await response.json();
      if (!response.ok && !body.preview)
        throw new Error(body.error ?? "Eligibility preview failed.");
      const nextPreview = body.preview ?? body;
      setPreview(nextPreview);
      setCurrentStep(3);
      setConfirmationId(nextPreview.eligible ? crypto.randomUUID() : null);
    } catch (previewError) {
      setError((previewError as Error).message);
    } finally {
      setPreviewing(false);
      requestLock.current = false;
    }
  }

  async function issueVoucher() {
    if (
      !member ||
      !allocation ||
      !preview?.eligible ||
      !confirmationId ||
      reason.trim().length < 4 ||
      requestLock.current
    )
      return;
    requestLock.current = true;
    setIssuing(true);
    setError(null);
    try {
      const response = await fetch("/api/vouchers/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_username: member.username,
          allocation_id: allocation.id,
          operator_reason: [reason.trim(), note.trim()]
            .filter(Boolean)
            .join(": ")
            .slice(0, 500),
          confirmation_id: confirmationId,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.voucher)
        throw new Error(body.error ?? "Voucher issuance failed.");
      setIssued(body.voucher);
    } catch (issueError) {
      setError((issueError as Error).message);
    } finally {
      setIssuing(false);
      requestLock.current = false;
    }
  }

  function resetMember() {
    setMember(null);
    setQuery("");
    setAllocationId("");
    setPreview(null);
    setConfirmationId(null);
    setIssued(null);
    setReason("");
    setNote("");
    setError(null);
    setCurrentStep(1);
  }

  const primary =
    "min-h-12 w-full rounded-control bg-[#005C55] text-base text-white hover:bg-[#0F766E]";
  const secondary =
    "min-h-12 w-full rounded-control bg-[#EAEDFF] text-base text-primary-strong";
  function chooseMember(result: MemberResult) {
    setMember(result);
    setPreview(null);
    setConfirmationId(null);
    setAllocationId("");
    setError(null);
  }
  const unavailable = allocations.filter(
    (option) =>
      option.quantityRemaining < 1 ||
      option.availableBudgetMinor < option.maximumReimbursementMinor
  );
  const available = allocations.filter(
    (option) => !unavailable.includes(option)
  );
  if (issued)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center sm:px-6 sm:py-20">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#99F1E5] text-[#005C55]">
          <CheckCircle2 className="h-14 w-14" aria-hidden="true" />
        </div>
        <h2
          ref={heading}
          tabIndex={-1}
          className="mt-6 text-3xl font-semibold tracking-tight outline-none"
        >
          Voucher issued
        </h2>
        <p className="mt-3 text-base leading-7 text-ink-muted">
          {allocation?.title} has been issued to{" "}
          <strong className="text-ink">@{issued.recipient}</strong>.
        </p>
        <p className="mt-5 max-w-full break-all rounded-full bg-[#EAEDFF] px-4 py-3 text-xs text-ink-muted">
          Reference: {issued.auditReference}
        </p>
        {issued.idempotent && (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            The original voucher was returned. No duplicate was issued.
          </p>
        )}
        <div className="mt-8 w-full space-y-3">
          <Button asChild className={primary}>
            <Link
              href={`/vouchers/issued/${issued.id}?returnTo=%2Fvouchers%2Fgrants`}
            >
              View voucher{" "}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button className={secondary} onClick={resetMember}>
            Issue another voucher
          </Button>
          <Link
            href="/vouchers"
            className="flex min-h-12 items-center justify-center text-sm text-ink-muted"
          >
            Back to vouchers
          </Link>
        </div>
      </div>
    );
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-152px)] max-w-2xl flex-col gap-5 px-4 pb-6 pt-5 sm:px-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight outline-none"
          >
            {currentStep === 1
              ? "Issue voucher"
              : currentStep === 2
              ? "Select voucher"
              : "Review issuance"}
          </h2>
          <span className="shrink-0 rounded-full bg-[#E2E7FF] px-3 py-1 text-xs font-medium text-primary-strong">
            Step {currentStep} of 3
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Issuance progress"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={3}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#EAEDFF]"
        >
          <div
            style={{ width: `${(currentStep / 3) * 100}%` }}
            className="h-full rounded-full bg-[#005C55]"
          />
        </div>
      </div>
      {currentStep === 1 && (
        <>
          <label htmlFor="member-search" className="sr-only">
            Search member username
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id="member-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMember(null);
                setMembers([]);
              }}
              placeholder="Search by username"
              className="min-h-14 w-full rounded-card border-0 bg-white pl-12 pr-11 text-base shadow-sm focus-visible:outline-primary"
            />
            {searching && (
              <Loader2
                aria-label="Searching"
                className="absolute right-4 top-4 h-5 w-5 animate-spin text-primary"
              />
            )}
          </div>
          <p aria-live="polite" className="text-sm text-ink-muted">
            {searching
              ? "Searching…"
              : query.trim().length < 2
              ? "Enter at least two characters."
              : `${members.length || (member ? 1 : 0)} matching members`}
          </p>
          <fieldset className="space-y-3">
            <legend className="sr-only">Select member</legend>
            {(member && members.length === 0 ? [member] : members).map(
              (result) => (
                <label
                  key={result.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-card p-4 shadow-sm",
                    member?.id === result.id ? "bg-[#E2E7FF]" : "bg-white"
                  )}
                >
                  <input
                    type="radio"
                    name="member"
                    checked={member?.id === result.id}
                    onChange={() => chooseMember(result)}
                    className="mt-3 h-5 w-5 shrink-0 accent-[#005C55]"
                  />
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#99F1E5] font-semibold text-primary-strong"
                    aria-hidden="true"
                  >
                    {result.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 py-1">
                    <span className="block break-all text-base font-semibold">
                      @{result.username}
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {result.maskedContact}
                    </span>
                  </span>
                </label>
              )
            )}
          </fieldset>
          {!searching &&
            query.trim().length >= 2 &&
            members.length === 0 &&
            !member &&
            !error && (
              <p className={voucherCard}>
                No matching members. Check the username and try again.
              </p>
            )}
        </>
      )}
      {currentStep === 2 && (
        <>
          <div className={`${voucherCard} flex items-center gap-3`}>
            <UserRound
              aria-hidden="true"
              className="h-6 w-6 shrink-0 text-primary"
            />
            <p className="min-w-0 flex-1 break-all font-semibold">
              @{member?.username}
            </p>
            <Button
              variant="ghost"
              disabled={previewing}
              onClick={() => setCurrentStep(1)}
              className="min-h-11 text-primary-strong"
            >
              Change
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Available vouchers</h3>
            <span className="text-sm text-ink-muted">{available.length}</span>
          </div>
          <fieldset className="space-y-3">
            <legend className="sr-only">Choose voucher</legend>
            {available.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-card p-4 shadow-sm",
                  allocationId === option.id ? "bg-[#E2E7FF]" : "bg-white"
                )}
              >
                <input
                  type="radio"
                  name="allocation"
                  disabled={previewing}
                  value={option.id}
                  checked={allocationId === option.id}
                  onChange={() => {
                    setAllocationId(option.id);
                    setPreview(null);
                    setConfirmationId(null);
                    setError(null);
                  }}
                  className="mt-1 h-5 w-5 shrink-0 accent-[#005C55]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-sm">
                    {option.merchantName}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    {option.benefitLabel}
                  </span>
                  <span className="mt-3 block text-xs text-ink-muted">
                    Closes {voucherDateTime(option.expiresAt)} ·{" "}
                    {option.quantityRemaining} left
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {!available.length && (
            <p className={voucherCard}>
              No vouchers are open for direct issuance.
            </p>
          )}
          {!!unavailable.length && (
            <details className="rounded-card bg-[#F2F3FF] p-4">
              <summary className="cursor-pointer py-2 font-medium">
                Unavailable vouchers ({unavailable.length})
              </summary>
              <ul className="mt-3 divide-y divide-[#DAE2FD]">
                {unavailable.map((option) => (
                  <li key={option.id} className="py-3 text-sm">
                    <p className="font-medium">{option.title}</p>
                    <p className="mt-1 text-ink-muted">
                      {option.quantityRemaining < 1
                        ? "No vouchers remaining"
                        : "Insufficient allocation budget"}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {currentStep === 3 && allocation && (
        <>
          <section className="rounded-card bg-[#F2F3FF] p-5 [&_dl>div]:py-3">
            <h3 className="mb-5 font-semibold">Issuance details</h3>
            <VoucherFacts
              items={[
                { label: "Member", value: `@${member?.username}` },
                { label: "Merchant", value: allocation.merchantName },
                { label: "Voucher", value: allocation.title },
                { label: "Quantity", value: "1 voucher" },
                ...(allocation.voucherValiditySeconds
                  ? [
                      {
                        label: "Voucher validity",
                        value: `${Math.round(
                          allocation.voucherValiditySeconds / 3600
                        )} hours after issue`,
                      },
                    ]
                  : []),

                {
                  label: "Allocation closes",
                  value: voucherDateTime(allocation.expiresAt),
                },
                {
                  label: "Funding reserved",
                  value: (
                    <span>
                      {formatMoney(
                        minorToMajor(allocation.maximumReimbursementMinor),
                        allocation.currency
                      )}
                      <span className="mt-1 block font-normal text-ink-muted">
                        {allocation.fundName}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          </section>
          <section className={voucherCard}>
            <h3
              className={cn(
                "flex items-center gap-2 font-semibold",
                preview?.eligible ? "text-primary-strong" : "text-danger"
              )}
            >
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              {preview?.eligible
                ? "Ready to issue"
                : "Cannot issue this voucher"}
            </h3>
            {!preview?.eligible && (
              <p className="mt-2 text-sm text-ink-muted">{preview?.message}</p>
            )}
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-muted">
                View eligibility checks
              </summary>
              <ul className="space-y-2">
                {preview?.requirements.map((r) => (
                  <li key={r.label} className="flex items-start gap-2 text-sm">
                    <span
                      className={r.satisfied ? "text-primary" : "text-danger"}
                    >
                      {r.satisfied ? (
                        <Check className="h-4 w-4" aria-label="Passed" />
                      ) : (
                        <AlertCircle className="h-4 w-4" aria-label="Failed" />
                      )}
                    </span>
                    {r.label}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <label className="block text-sm font-medium">
            Issuance reason <span className="text-danger">*</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!preview?.eligible || issuing}
              className="mt-2 min-h-12 w-full rounded-control border-0 bg-white px-4 text-base focus-visible:outline-primary"
            >
              <option value="">Select reason</option>
              <option>Customer support exception</option>
              <option>Service recovery</option>
              <option>Approved campaign distribution</option>
              <option>Other operational exception</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Internal note{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!preview?.eligible || issuing}
              rows={3}
              maxLength={400}
              className="mt-2 w-full rounded-card border-0 bg-white p-4 text-base focus-visible:outline-primary"
              placeholder="Add a note…"
            />
          </label>
        </>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-control bg-danger/5 p-4 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="sticky bottom-20 z-10 mt-auto space-y-2 bg-[#FAF8FF]/95 py-3 backdrop-blur sm:bottom-0">
        <Button
          className={primary}
          disabled={
            currentStep === 1
              ? !member
              : currentStep === 2
              ? !allocation || previewing
              : !preview?.eligible || reason.trim().length < 4 || issuing
          }
          onClick={() =>
            currentStep === 1
              ? setCurrentStep(2)
              : currentStep === 2
              ? void checkEligibility()
              : void issueVoucher()
          }
        >
          {previewing || issuing ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : currentStep === 3 ? (
            <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
          ) : null}
          {issuing
            ? "Issuing…"
            : previewing
            ? "Checking…"
            : currentStep === 3
            ? "Issue voucher"
            : "Continue"}
        </Button>
        {currentStep === 1 ? (
          <Link
            href="/vouchers"
            className="flex min-h-11 items-center justify-center text-sm text-ink-muted"
          >
            Cancel
          </Link>
        ) : (
          <Button
            className={secondary}
            disabled={issuing || previewing}
            onClick={() => {
              setCurrentStep(currentStep - 1);
              setError(null);
            }}
          >
            Back
          </Button>
        )}
      </div>
    </div>
  );
}
