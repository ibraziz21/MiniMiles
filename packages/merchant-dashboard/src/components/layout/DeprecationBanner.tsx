import { ArrowRight } from "lucide-react";

/**
 * Phase-5 deprecation notice. Renders only when NEXT_PUBLIC_NEW_DASHBOARD_URL
 * is set. Once MIGRATION_REDIRECT=1 the middleware hard-redirects and this
 * banner is never seen.
 */
export function DeprecationBanner() {
  const url = process.env.NEXT_PUBLIC_NEW_DASHBOARD_URL;
  if (!url) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 border-b border-amber-200">
      <span>
        This dashboard is moving. Your account and data are already available on the new
        AkibaMiles Merchant Portal.
      </span>
      <a
        href={url}
        className="inline-flex items-center gap-1 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
      >
        Switch now <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
