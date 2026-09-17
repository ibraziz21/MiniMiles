"use client";

import { Lock } from "lucide-react";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { EditSheet } from "@/components/akiba/EditSheet";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Thin client wrapper around EditSheet's render-prop API. page.tsx is a
 * Server Component — passing `trigger`/`children` functions to a Client
 * Component directly from server code isn't valid in RSC (functions aren't
 * serializable across that boundary), so this stays entirely client-side.
 */
export function SecuritySettings() {
  return (
    <EditSheet
      title="Security"
      trigger={(open) => (
        <SettingsRow
          icon={<Lock className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
          label="Security"
          description="Password & sign-in"
          onClick={open}
        />
      )}
    >
      {() => <SetPasswordForm />}
    </EditSheet>
  );
}
