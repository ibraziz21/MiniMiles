import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const checks = [
    { label: "Supabase URL", ok: Boolean(process.env.SUPABASE_URL) },
    { label: "Supabase service key", ok: Boolean(process.env.SUPABASE_SERVICE_KEY) },
    { label: "Session secret", ok: Boolean(process.env.SESSION_SECRET) },
    { label: "Bootstrap enabled", ok: Boolean(process.env.ADMIN_BOOTSTRAP_SECRET) },
  ];

  return (
    <div>
      <TopBar title="Settings" subtitle="Environment and admin package configuration" />
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{check.label}</span>
                <span className={check.ok ? "text-emerald-600" : "text-red-600"}>{check.ok ? "set" : "missing"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Current Session</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-slate-400">Email:</span> {session.email}</p>
            <p><span className="text-slate-400">Role:</span> {session.role}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
