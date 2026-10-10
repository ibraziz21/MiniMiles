import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileSettingsForm } from "@/components/settings/ProfileSettingsForm";
import { PasswordSettingsForm } from "@/components/settings/PasswordSettingsForm";
import { SystemSettingsForm } from "@/components/settings/SystemSettingsForm";

// SystemSettingsForm bundles Security Policy + Subscription Receipt Details
// ("Organization") + Notifications into one <form> with a single submit —
// spec §10.9 wants these as separate tabs, but splitting a single form's
// fields across independently-mounted Radix Tabs panels would unmount
// off-screen fields and silently drop their values on submit. Keeping it as
// one "Organization & Security" tab here is the presentational-only-safe
// choice; a true 3-way split needs SystemSettingsForm restructured into
// independent forms, which is a behavior change out of scope for this pass.
export default async function SettingsPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  const settings = await getAdminSettings();
  const isSuperAdmin = session.role === "super_admin";

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account security and admin preferences" />
      <div className="p-4 sm:p-6">
        <Tabs defaultValue="organization">
          <TabsList>
            <TabsTrigger value="organization">Organization &amp; Security</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="session">Session</TabsTrigger>
          </TabsList>

          <TabsContent value="organization">
            <Card>
              <CardHeader>
                <CardTitle>System Settings</CardTitle>
                <CardDescription>Security policy, subscription receipt details, and notification recipients.</CardDescription>
              </CardHeader>
              <CardContent>
                <SystemSettingsForm settings={settings} canEdit={isSuperAdmin && !session.openAccess} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile">
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
          </TabsContent>

          <TabsContent value="password">
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
          </TabsContent>

          <TabsContent value="session">
            <Card>
              <CardHeader><CardTitle>Current Session</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase text-ink-muted">Email</p>
                  <p className="mt-1 text-ink">{session.email}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-ink-muted">Role</p>
                  <p className="mt-1 text-ink">{session.role}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-ink-muted">Mode</p>
                  <p className="mt-1 text-ink">{session.openAccess ? "Open access" : "Authenticated"}</p>
                </div>
                {session.mustChangePassword && (
                  <div>
                    <p className="text-xs font-medium uppercase text-warning">Action Required</p>
                    <p className="mt-1 text-warning">Change your temporary password to unlock the dashboard.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
