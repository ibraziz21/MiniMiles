"use client";

import { useRef, useState } from "react";
import Script from "next/script";
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Send,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type PartnerLeadFormProps = {
  eyebrow?: string;
  title?: string;
  body?: string;
  source?: string;
  intentLabel?: string;
  intentOptions?: string[];
  messageLabel?: string;
  messagePlaceholder?: string;
  submitLabel?: string;
  successMessage?: string;
  className?: string;
};

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const inputClass =
  "h-12 rounded-lg border border-akiba-line bg-white px-4 text-base font-normal text-akiba-ink outline-none transition placeholder:text-akiba-muted/60 focus:border-akiba-teal focus:ring-4 focus:ring-akiba-teal/10";

export function PartnerLeadForm({
  eyebrow,
  title = "Start the conversation",
  body = "Tell us what you want to launch. We will follow up with a clear path forward.",
  source = "website_partners_page",
  intentLabel = "I am interested in",
  intentOptions = [],
  messageLabel = "What are you trying to launch?",
  messagePlaceholder = "Tell us about the campaign, audience, reward, or KPI you want to move.",
  submitLabel = "Send inquiry",
  successMessage = "Thanks. We will review your inquiry and follow up.",
  className,
}: PartnerLeadFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const intent = String(data.get("intent") ?? "");
    const rawMessage = String(data.get("message") ?? "");
    const message = [intent ? `Interest: ${intent}` : "", rawMessage]
      .filter(Boolean)
      .join("\n\n");

    setState({ status: "submitting", message: "Sending inquiry..." });

    try {
      const res = await fetch("/api/partner-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          company: String(data.get("company") ?? ""),
          country: String(data.get("country") ?? ""),
          role: String(data.get("role") ?? ""),
          website: String(data.get("website") ?? ""),
          message,
          source,
          websiteUrl: String(data.get("websiteUrl") ?? ""),
          turnstileToken: String(data.get("cf-turnstile-response") ?? ""),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "We could not send your inquiry.");
      }

      form.reset();
      setState({
        status: "success",
        message: successMessage,
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "We could not send your inquiry.",
      });
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className={cn(
        "grid gap-5 rounded-lg border border-akiba-line bg-white p-5 shadow-soft sm:p-6",
        className,
      )}
    >
      {siteKey ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      ) : null}

      <div>
        {eyebrow ? (
          <p className="font-sterling text-sm font-medium text-akiba-teal">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="mt-2 font-sterling text-3xl font-medium leading-tight text-akiba-ink">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-7 text-akiba-muted">{body}</p>
      </div>

      <input
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        name="websiteUrl"
        aria-hidden="true"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" autoComplete="name" icon={UserRound} required />
        <Field label="Email" name="email" type="email" autoComplete="email" icon={Mail} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" name="company" autoComplete="organization" icon={Building2} required />
        <Field label="Country" name="country" autoComplete="country-name" icon={MapPin} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" name="role" autoComplete="organization-title" icon={BriefcaseBusiness} />
        <Field label="Website" name="website" type="url" autoComplete="url" icon={Globe2} />
      </div>

      {intentOptions.length > 0 ? (
        <SelectField label={intentLabel} name="intent" options={intentOptions} />
      ) : null}

      <label className="grid gap-2 text-sm font-medium text-akiba-ink">
        {messageLabel}
        <span className="relative block">
          <MessageSquare className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-akiba-muted/50" />
          <textarea
            name="message"
            required
            rows={5}
            className={cn(inputClass, "min-h-32 w-full py-3 pl-10")}
            placeholder={messagePlaceholder}
          />
        </span>
      </label>

      {siteKey ? (
        <div className="cf-turnstile min-h-[65px]" data-sitekey={siteKey} />
      ) : null}

      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-akiba-teal px-6 py-3 font-sterling text-base font-medium leading-none text-white transition hover:bg-[#1E7E8D] focus:outline-none focus:ring-4 focus:ring-akiba-teal/20 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state.status === "submitting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state.status === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {submitLabel}
      </button>

      {state.message ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium",
            state.status === "error"
              ? "bg-red-50 text-red-700"
              : "bg-akiba-tint text-akiba-teal",
          )}
        >
          {state.status === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>{state.message}</p>
        </div>
      ) : null}
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  icon: Icon,
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  icon?: LucideIcon;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-akiba-ink">
      {label}
      <span className="relative block">
        {Icon ? (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-akiba-muted/50" />
        ) : null}
        <input
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          className={cn(inputClass, "w-full", Icon && "pl-10")}
        />
      </span>
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: string[];
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-akiba-ink">
      {label}
      <span className="relative block">
        <select
          name={name}
          defaultValue={options[0] ?? ""}
          className={cn(inputClass, "w-full appearance-none pr-10")}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-akiba-muted/50" />
      </span>
    </label>
  );
}
