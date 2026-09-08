"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";

type Plan = {
  name: string;
  monthlyPrice: number;
  features: readonly string[];
};

type BillingPeriod = "monthly" | "quarterly" | "annual";

type SubscriptionPlansProps = {
  plans: readonly Plan[];
  merchantUrl: string;
};

const billingOptions: Array<{
  id: BillingPeriod;
  label: string;
  discount: number;
  months: number;
  billedLabel: string;
}> = [
  { id: "monthly", label: "Monthly", discount: 0, months: 1, billedLabel: "monthly" },
  { id: "quarterly", label: "Quarterly", discount: 0.05, months: 3, billedLabel: "quarterly" },
  { id: "annual", label: "Annual", discount: 0.2, months: 12, billedLabel: "annually" },
];

const currency = new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function SubscriptionPlans({ plans, merchantUrl }: SubscriptionPlansProps) {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const billing = billingOptions.find((option) => option.id === billingPeriod)!;

  return (
    <div>
      <div
        className="mx-auto mt-8 flex w-full max-w-xl rounded-full border border-akiba-line bg-white p-1.5 shadow-chip"
        aria-label="Billing period"
      >
        {billingOptions.map((option) => {
          const isActive = option.id === billingPeriod;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setBillingPeriod(option.id)}
              aria-pressed={isActive}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition sm:gap-2 ${
                isActive
                  ? "bg-akiba-ink text-white"
                  : "text-akiba-muted hover:bg-akiba-tint hover:text-akiba-ink"
              }`}
            >
              <span>{option.label}</span>
              {option.discount > 0 && (
                <span
                  className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline ${
                    isActive ? "bg-akiba-teal text-white" : "bg-akiba-tint text-akiba-teal"
                  }`}
                >
                  Save {option.discount * 100}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-8 rounded-xl border border-akiba-line bg-white px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="font-sterling text-lg font-medium text-akiba-ink">Included with every plan</p>
          <ul className="grid gap-x-6 gap-y-2 text-sm text-akiba-muted sm:grid-cols-2 lg:grid-cols-4">
            {["Merchant dashboard", "Scan & Award", "Voucher management", "Activity reporting"].map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-akiba-teal" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {plans.map((plan) => {
          const effectiveMonthlyPrice = plan.monthlyPrice * (1 - billing.discount);
          const billedPrice = effectiveMonthlyPrice * billing.months;
          const querySeparator = merchantUrl.includes("?") ? "&" : "?";
          const planUrl = `${merchantUrl}${querySeparator}plan=${encodeURIComponent(plan.name.toLowerCase())}&billing=${billing.id}`;

          return (
            <article
              key={plan.name}
              className="flex flex-col rounded-xl border border-akiba-line bg-white p-6 shadow-chip transition hover:-translate-y-1 hover:border-akiba-teal"
            >
              <div>
                <p className="font-sterling text-2xl font-medium text-akiba-ink">{plan.name}</p>
                <div className="mt-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <span className="font-sterling text-lg font-medium text-akiba-muted">KES</span>
                  <span className="font-sterling text-4xl font-semibold text-akiba-ink sm:text-5xl">
                    {currency.format(effectiveMonthlyPrice)}
                  </span>
                  <span className="text-sm text-akiba-muted">/month</span>
                </div>
                <p className="mt-2 min-h-5 text-xs text-akiba-muted">
                  {billing.id === "monthly"
                    ? "Billed monthly"
                    : `KES ${currency.format(billedPrice)} billed ${billing.billedLabel}`}
                </p>
              </div>

              <div className="my-6 h-px bg-akiba-line" />

              <ul className="flex-1 space-y-3.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm leading-6">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-akiba-teal" aria-hidden="true" />
                    <span className="text-akiba-muted">{feature}</span>
                  </li>
                ))}
              </ul>

              <ButtonLink href={planUrl} className="mt-7 w-full">
                Choose {plan.name}
              </ButtonLink>
            </article>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col items-start justify-between gap-5 rounded-xl bg-akiba-ink p-6 text-white sm:flex-row sm:items-center">
        <div>
          <p className="font-sterling text-xl font-medium">More than 2 branches or KES 5,000,000 in monthly sales?</p>
          <p className="mt-1 text-sm leading-6 text-white/60">Talk to us about a plan shaped around your locations and monthly activity.</p>
        </div>
        <ButtonLink href="/merchants#contact" variant="secondary" className="shrink-0 border-white/20 bg-white">
          Contact our team
        </ButtonLink>
      </div>
    </div>
  );
}
