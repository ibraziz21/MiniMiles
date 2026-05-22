import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordSettingsForm } from "@/components/settings/PasswordSettingsForm";

export default async function SettingsPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar title="Settings" subtitle="Account security and admin preferences" />
      <div className="grid gap-4 p-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader><CardTitle>Account Security</CardTitle></CardHeader>
          <CardContent>
            <PasswordSettingsForm email={session.email} disabled={session.openAccess} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Current Session</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">Email</p>
              <p className="mt-1 text-slate-900">{session.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">Role</p>
              <p className="mt-1 text-slate-900">{session.role}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">Mode</p>
              <p className="mt-1 text-slate-900">{session.openAccess ? "Open access" : "Authenticated"}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
