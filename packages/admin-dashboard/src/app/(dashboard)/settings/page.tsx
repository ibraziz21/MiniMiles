import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileSettingsForm } from "@/components/settings/ProfileSettingsForm";
import { PasswordSettingsForm } from "@/components/settings/PasswordSettingsForm";
import { SystemSettingsForm } from "@/components/settings/SystemSettingsForm";

export default async function SettingsPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  const settings = await getAdminSettings();
  const isSuperAdmin = session.role === "super_admin";

  return (
    <div>
      <TopBar title="Settings" subtitle="Account security and admin preferences" />
      <div className="grid gap-4 p-6 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>Security policy, payout defaults, and notification recipients.</CardDescription>
            </CardHeader>
            <CardContent>
              <SystemSettingsForm settings={settings} canEdit={isSuperAdmin && !session.openAccess} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Profile</CardTitle>
              <CardDescription>Update your admin identity and login email.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileSettingsForm
                name={session.name}
                email={session.email}
                disabled={session.openAccess}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Security</CardTitle>
              <CardDescription>Password changes are audited.</CardDescription>
            </CardHeader>
            <CardContent>
              <PasswordSettingsForm
                email={session.email}
                minLength={settings.security.passwordMinLength}
                mustChangePassword={session.mustChangePassword}
                disabled={session.openAccess}
              />
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
              {session.mustChangePassword && (
                <div>
                  <p className="text-xs font-medium uppercase text-amber-500">Action Required</p>
                  <p className="mt-1 text-amber-700">Change your temporary password to unlock the dashboard.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
