"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3 } from "lucide-react";
import { concept, createResearchSubmissionId, exclusiveChoices, questions, sections, validateStep, type Answers } from "@/lib/merchant-order-research";

import { Eyebrow } from "@/components/Eyebrow";
import { conceptSw, kiswahili } from "./kiswahili";

type Invite = { merchantId?: string; cohort?: string };

export function ResearchForm(invite: Invite) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const t = (text: string) => language === "sw" ? kiswahili[text] ?? text : text;
  return (
    <main className="hero-wash min-h-screen" lang={language}>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:gap-8 sm:px-8 sm:py-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:py-20">
        <header className="lg:sticky lg:top-28 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 lg:justify-start">
            <Eyebrow>{t("Merchant research")}</Eyebrow>
            <div className="inline-flex rounded-lg border border-akiba-line bg-white p-1">
              {(["en", "sw"] as const).map((option) => (
                <button key={option} type="button" lang={option} aria-pressed={language === option}
                  onClick={() => setLanguage(option)}
                  className={`min-h-11 rounded-md px-2.5 text-sm font-semibold ${language === option ? "bg-akiba-tint text-[#176575]" : "text-akiba-muted"}`}>
                  {option === "en" ? "English" : "Kiswahili"}
                </button>
              ))}
            </div>
          </div>
          <h1 className={`mt-4 max-w-lg font-sterling text-3xl font-medium leading-[1.05] tracking-tight text-akiba-ink sm:text-5xl lg:text-6xl ${step > 0 ? "sr-only lg:not-sr-only lg:mt-5" : ""}`}>
            {t("How do you take orders online?")}
          </h1>
          <p className={`mt-3 max-w-md text-sm leading-6 text-akiba-muted sm:text-base ${step > 0 ? "hidden lg:block" : ""}`}>
            {t("We’re exploring a way for businesses to receive and manage orders through Akiba. Tell us how it works for you today and what would make a new tool worth using.")}
          </p>
          <p className={`mt-3 items-center gap-2 text-sm font-semibold text-[#176575] ${step > 0 ? "hidden lg:inline-flex" : "inline-flex"}`}>
            <Clock3 size={16} aria-hidden="true" /> {t("About 4 minutes")}
          </p>
        </header>
        <Survey invite={invite} language={language} t={t} step={step} setStep={setStep} />
      </div>
    </main>
  );
}

const merchantBenefits = [
  ["Miles and vouchers", "Automatically award AkibaMiles on eligible completed orders and let customers redeem vouchers when they order."],
  ["Stock, orders, and customer records", "Manage product availability, see which orders need attention, and find customer and order history in one place."],
  ["Payment and handover records", "Check M-Pesa references against your own records, record handover with a delivery PIN, and keep a record of reported issues."],
] as const;

const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#176575] px-5 font-semibold text-white hover:bg-[#104d59] disabled:opacity-55";
const field = "w-full rounded-xl border border-akiba-line bg-white p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#176575]";

const questionPages = [
  [["category", "shopType"]],
  [["channels", "barrier"], ["volume", "example"], ["problems"], ["paymentTiming", "paymentAccounts"], ["paymentChecks", "delivery"]],
  [["intent", "conditions"], ["catalogue", "rewards", "rewardBudget"]],
  [["followUp", "business", "contact"]],
];

function pagesFor(step: number, answers: Answers) {
  const available = questions(step, answers);
  return questionPages[step].map((keys) => available.filter(({ key }) => keys.includes(key))).filter((page) => page.length);
}

function Survey({ invite, language, t, step, setStep }: {
  invite: Invite;
  language: "en" | "sw";
  t: (text: string) => string;
  step: number;
  setStep: (step: number) => void;
}) {
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const submissionId = useRef<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pages = pagesFor(step, answers);
  const visible = pages[page].filter(({ key }) => !invite.merchantId || key !== "business");

  useEffect(() => {
    if (!sent) return;
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [sent]);

  function update(key: string, value: string, multiple: boolean, maxChoices = Infinity) {
    setError("");
    setAnswers((previous) => {
      if (!multiple) return { ...previous, [key]: value };
      const current = previous[key];
      const selected = Array.isArray(current) ? current : [];
      if (selected.includes(value)) return { ...previous, [key]: selected.filter((item) => item !== value) };
      const remaining = selected.filter((item) => !exclusiveChoices.includes(item));
      if (exclusiveChoices.includes(value)) return { ...previous, [key]: [value] };
      return remaining.length < maxChoices ? { ...previous, [key]: [...remaining, value] } : previous;
    });
  }

  function goTo(next: number, nextPage = 0) {
    setStep(next);
    setPage(nextPage);
    setError("");
    requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const invalid = validateStep(step, answers, visible.map(({ key }) => key));
    if (invalid) {
      setError("Choose an answer to continue.");
      form.current?.querySelector<HTMLElement>(`[name="${invalid.key}"]`)?.focus();
      return;
    }
    if (page + 1 < pages.length) {
      goTo(step, page + 1);
      return;
    }
    if (step < sections.length - 1) {
      goTo(step + 1);
      return;
    }

    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      submissionId.current ??= createResearchSubmissionId();
      const response = await fetch("/api/merchant-order-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: submissionId.current, answers, language, merchantId: data.get("merchantId"), cohort: invite.cohort, website: data.get("website") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "We couldn’t send your responses. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const card = "min-w-0 rounded-2xl border border-akiba-line bg-white p-4 shadow-soft sm:rounded-[1.5rem] sm:p-8";
  if (sent) return (
    <section className={card}>
      <Check className="text-[#176575]" aria-hidden="true" />
      <h2 ref={heading} tabIndex={-1} className="mt-4 scroll-mt-32 font-sterling text-3xl">{t("Thanks for sharing.")}</h2>
      <p className="mt-2 text-akiba-muted">{t("Your response will help us decide what to test with merchants.")}</p>
    </section>
  );

  return (
    <form ref={form} onSubmit={submit} className={card}>
      <p className="text-sm font-semibold text-[#176575]">{language === "sw" ? `Hatua ya ${step + 1} kati ya ${sections.length}` : `Step ${step + 1} of ${sections.length}`}</p>
      <div className="mt-3 flex gap-2" aria-hidden="true">
        {sections.map((section, index) => <span key={section} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-[#176575]" : "bg-akiba-tint"}`} />)}
      </div>
      <h2 ref={heading} tabIndex={-1} className="mt-4 scroll-mt-32 font-sterling text-2xl font-medium sm:text-3xl">
        {t(sections[step])}
        {pages.length > 1 && <span className="ml-2 whitespace-nowrap font-sans text-sm font-normal text-akiba-muted">({page + 1}/{pages.length})</span>}
      </h2>
      {step === 2 && page === 0 && (
        <div className="mt-4 rounded-xl bg-akiba-tint p-4 text-sm leading-6 text-akiba-ink sm:p-5">
          <p>{language === "sw" ? conceptSw : concept}</p>
          <ul className="mt-4 space-y-3">
            {merchantBenefits.map(([title, description]) => (
              <li key={title} className="flex items-start gap-2.5">
                <Check size={16} className="mt-1 shrink-0 text-[#176575]" aria-hidden="true" />
                <div><strong className="block">{t(title)}</strong>{t(description)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {visible.some(({ key }) => key === "example") && <p className="mt-2 text-sm text-akiba-muted">{t("Please leave out customer names, phone numbers, and payment codes.")}</p>}
      <div className="mt-6 divide-y divide-akiba-line">
        {visible.map((question) => {
          const value = answers[question.key];
          const input = { id: question.key, name: question.key, className: field, value: typeof value === "string" ? value : "" };
          return (
            <div key={question.key} className="py-4 first:pt-0">
              {question.options ? (
                <fieldset>
                  <legend className="font-semibold">{t(question.label)}</legend>
                  {question.maxChoices && <p className="mt-1 text-sm text-akiba-muted">{t(question.maxChoices === 2 ? "Choose up to two" : "Select all that apply")}</p>}
                  <div className="mt-3 grid gap-2">
                    {question.options.map((option) => {
                      const selected = Array.isArray(value) ? value.includes(option) : value === option;
                      const limited = Array.isArray(value) && value.length >= (question.maxChoices ?? Infinity) &&
                        !selected && !exclusiveChoices.includes(option) && !value.some((item) => exclusiveChoices.includes(item));
                      return (
                        <label key={option} className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 text-base leading-snug has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#176575] ${selected ? "border-[#176575] bg-akiba-tint" : "border-akiba-line"} ${limited ? "opacity-50" : "cursor-pointer hover:bg-akiba-tint"}`}>
                          <input className="h-4 w-4 shrink-0 accent-[#176575]" type={question.maxChoices ? "checkbox" : "radio"} name={question.key} checked={selected} disabled={limited} onChange={() => update(question.key, option, Boolean(question.maxChoices), question.maxChoices)} />
                          {t(option)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <>
                  <label htmlFor={question.key} className="mb-2 block font-semibold">{t(question.label)} <span className="text-sm font-normal text-akiba-muted">{t("(optional)")}</span></label>
                  {question.short
                    ? <input {...input} maxLength={254} onChange={(event) => update(question.key, event.target.value, false)} />
                    : <textarea {...input} rows={3} maxLength={1200} onChange={(event) => update(question.key, event.target.value, false)} />}
                </>
              )}
            </div>
          );
        })}
        {step === sections.length - 1 && answers.followUp && answers.followUp !== "Neither" && (
          <p className="py-3 text-sm text-akiba-muted">{t("We’ll only use this to contact you about this research.")}</p>
        )}
      </div>
      <input type="hidden" name="merchantId" value={invite.merchantId ?? ""} />
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
      {error && <p role="alert" className="mb-4 text-sm font-semibold text-red-800">{language === "sw" ? kiswahili[error] ?? t("We couldn’t send your responses. Please try again.") : error}</p>}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-akiba-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:px-0">
        {step > 0 || page > 0 ? <button type="button" disabled={pending} onClick={() => {
          if (page > 0) goTo(step, page - 1);
          else goTo(step - 1, pagesFor(step - 1, answers).length - 1);
        }} className="min-h-12 px-2 font-semibold text-[#176575]">{t("Back")}</button> : <span />}
        <button disabled={pending} type="submit" className={`${primary} ml-auto min-w-32`}>
          {t(pending ? "Sending…" : step === sections.length - 1 ? "Send response" : "Continue")}
          {!pending && step < sections.length - 1 && <ArrowRight size={18} aria-hidden="true" />}
        </button>
      </div>
      {step === sections.length - 1 && (
        <p className="mt-4 text-sm text-akiba-muted">
          {t("We use your answers for merchant research.")}{" "}
          <Link href="/privacy-policy" className="underline">{t("Privacy policy")}</Link>
        </p>
      )}
    </form>
  );
}
