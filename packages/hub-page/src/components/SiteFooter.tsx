import Link from "next/link";
import { PRIVACY_POLICY_URL, TERMS_URL, AKIBA_EMAIL } from "@/constants/links";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-akiba-ink px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/30">© {new Date().getFullYear()} AkibaMiles · Built by EcoLabs</p>
        <div className="flex gap-4 text-xs text-white/30">
          <Link href={PRIVACY_POLICY_URL} className="no-underline hover:text-white/60">
            Privacy
          </Link>
          <Link href={TERMS_URL} className="no-underline hover:text-white/60">
            Terms
          </Link>
          <a href={`mailto:${AKIBA_EMAIL}`} className="no-underline hover:text-white/60">
            {AKIBA_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
