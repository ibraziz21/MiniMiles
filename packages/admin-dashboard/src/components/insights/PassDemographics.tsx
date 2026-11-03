"use client";

import { useState } from "react";
import type { PassDemographics as Demographics, PassDemographicBreakdown } from "@/lib/passAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function displayLabel(label: string, title: string) {
  if (title === "Countries" && /^[A-Z]{2}$/.test(label)) {
    return countryNames.of(label) ?? label;
  }
  if (title === "Cities") {
    return label.replace(/ · ([A-Z]{2})$/, (_, code: string) => ` · ${countryNames.of(code) ?? code}`);
  }
  return label;
}

function share(count: number, total: number) {
  return total ? `${((count / total) * 100).toFixed(1)}%` : "0%";
}

function Breakdown({ title, data, total }: {
  title: string;
  data: PassDemographicBreakdown;
  total: number;
}) {
  const missing = total - data.known;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-ink-muted">{formatNumber(data.known)} of {formatNumber(total)} provided · {share(data.known, total)}</p>
      </CardHeader>
      <CardContent>
        {total === 0 ? <p className="text-sm text-ink-muted">No Pass holders in this period.</p> : (
          <>
            <div className="max-h-80 overflow-y-auto" role="region" aria-label={`${title} breakdown`} tabIndex={0}>
              <table className="w-full text-sm">
                <caption className="sr-only">{title}: users and percentage of all {formatNumber(total)} Pass holders in this cohort</caption>
                <thead>
                  <tr className="text-xs text-ink-muted">
                    <th scope="col" className="py-2 text-left">{title === "Interests" ? "Interest" : title === "Cities" ? "City · Country" : "Country"}</th>
                    <th scope="col" className="py-2 pl-3 text-right">Users</th>
                    <th scope="col" className="py-2 pl-3 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="break-words py-2 text-left font-normal [overflow-wrap:anywhere]">{displayLabel(row.label, title)}</th>
                      <td className="py-2 pl-3 text-right tabular-nums">{formatNumber(row.users)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-ink-muted">{share(row.users, total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="py-2 text-left font-normal text-ink-muted">Not provided</th>
                    <td className="py-2 pl-3 text-right tabular-nums">{formatNumber(missing)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-ink-muted">{share(missing, total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {title === "Interests" ? <p className="mt-3 text-xs text-ink-muted">People can select multiple interests. Shares may total more than 100%.</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PassDemographics({ data, from, to }: { data: Demographics; from: string; to: string }) {
  const [scope, setScope] = useState<keyof Demographics>("selected");
  const cohort = data[scope];
  return (
    <section aria-labelledby="pass-demographics-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pass-demographics-title" className="text-lg font-semibold text-ink">Countries, cities & interests</h2>
          <p className="mt-1 text-sm text-ink-muted">Current profile data for {formatNumber(cohort.total)} Pass holders{scope === "selected" ? ` who signed up ${from} to ${to}` : " across all time"}.</p>
        </div>
        <label className="text-xs font-medium text-ink-muted">
          <span className="mb-1 block">Pass holders</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as keyof Demographics)} className="min-h-11 rounded-control border border-border bg-surface px-3 text-sm text-ink">
            <option value="selected">Selected signup period</option>
            <option value="all_time">All time</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="Countries" data={cohort.countries} total={cohort.total} />
        <Breakdown title="Cities" data={cohort.cities} total={cohort.total} />
        <Breakdown title="Interests" data={cohort.interests} total={cohort.total} />
      </div>
    </section>
  );
}
