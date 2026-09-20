import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { minorToKes } from "@/lib/voucherFunds";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/utils";

const STATE_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  pending_approval: "warning",
  approved: "outline",
  scheduled: "outline",
  active: "success",
  paused: "warning",
  ended: "destructive",
  cancelled: "destructive",
};

interface ProgramRow {
  id: string;
  name: string;
  sponsorship_label: string | null;
  country_code: string;
  currency: string;
  authorized_budget_minor: number;
  state: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

interface BudgetRow {
  program_id: string;
  available_budget_minor: number;
  committed_minor: number;
}

async function getFunds() {
  const [programsRes, budgetRes] = await Promise.all([
    supabase
      .from("voucher_funding_programs")
      .select("id, name, sponsorship_label, country_code, currency, authorized_budget_minor, state, starts_at, ends_at, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("v_voucher_funding_program_budget").select("program_id, available_budget_minor, committed_minor"),
  ]);

  const budgetByProgram = new Map<string, BudgetRow>();
  for (const row of (budgetRes.data ?? []) as BudgetRow[]) budgetByProgram.set(row.program_id, row);

  return ((programsRes.data ?? []) as ProgramRow[]).map((program) => ({
    program,
    budget: budgetByProgram.get(program.id) ?? null,
  }));
}

// Akiba-funded voucher funds — see
// packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §10.
export default async function VoucherFundsPage() {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const canCreate = hasPermission(session.role, "voucher_funds.write");

  const funds = await getFunds();

  return (
    <div>
      <TopBar
        title="Voucher Funds"
        subtitle="Akiba-funded voucher initiatives and their merchant allocations"
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/vouchers/funds/new">New fund</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-6 p-6">
        {funds.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No voucher funds yet</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-500">
              Create a fund to start allocating Akiba-funded vouchers to merchants.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Funds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {funds.map(({ program, budget }) => (
                <Link
                  key={program.id}
                  href={`/vouchers/funds/${program.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-3 text-sm hover:border-slate-200 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{program.name}</p>
                    <p className="text-xs text-slate-400">
                      {program.country_code} · {program.sponsorship_label ?? "Funded by Akiba"} ·{" "}
                      {formatDate(program.starts_at)} – {formatDate(program.ends_at)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>Authorized: {formatMoney(minorToKes(program.authorized_budget_minor), program.currency)}</p>
                    {budget && (
                      <p>Available: {formatMoney(minorToKes(budget.available_budget_minor), program.currency)}</p>
                    )}
                  </div>
                  <Badge variant={STATE_VARIANT[program.state] ?? "secondary"}>{program.state.replaceAll("_", " ")}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
