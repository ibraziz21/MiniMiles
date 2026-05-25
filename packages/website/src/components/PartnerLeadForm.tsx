"use client";

import { useRef, useState } from "react";
import Script from "next/script";
import { CheckCircle2, Loader2 } from "lucide-react";

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function PartnerLeadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

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
          message: String(data.get("message") ?? ""),
          source: "website_partners_page",
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
        message: "Thanks. We will review your partner inquiry and follow up.",
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
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4">
      {siteKey ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      ) : null}

      <input
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        name="websiteUrl"
        aria-hidden="true"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" name="company" autoComplete="organization" required />
        <Field label="Country" name="country" autoComplete="country-name" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" name="role" autoComplete="organization-title" />
        <Field label="Website" name="website" type="url" autoComplete="url" />
      </div>
      <label className="grid gap-2 text-sm font-medium text-akiba-ink">
        Campaign idea
        <textarea
          name="message"
          required
          rows={5}
          className="min-h-32 rounded-lg border border-akiba-line bg-white px-4 py-3 text-base font-normal text-akiba-ink outline-none transition placeholder:text-akiba-muted/60 focus:border-akiba-teal"
          placeholder="Tell us what kind of reward, voucher, or campaign you want to launch."
        />
      </label>

      {siteKey ? (
        <div className="cf-turnstile min-h-[65px]" data-sitekey={siteKey} />
      ) : null}

      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-akiba-teal px-6 py-3 font-sterling text-base font-medium leading-none text-white transition hover:bg-[#1E7E8D] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state.status === "submitting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state.status === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : null}
        Send inquiry
      </button>

      {state.message ? (
        <p
          className={
            state.status === "error"
              ? "text-sm font-medium text-red-600"
              : "text-sm font-medium text-akiba-teal"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-akiba-ink">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="h-12 rounded-lg border border-akiba-line bg-white px-4 text-base font-normal text-akiba-ink outline-none transition placeholder:text-akiba-muted/60 focus:border-akiba-teal"
      />
    </label>
  );
}
