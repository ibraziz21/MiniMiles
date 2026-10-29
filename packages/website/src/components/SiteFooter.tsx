import Link from "next/link";
import { Mail, Send, Twitter } from "lucide-react";
import { Logo } from "@/components/Logo";
import { siteConfig } from "@/content/site";

export function SiteFooter() {
  return (
    <footer className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="mx-auto w-full max-w-[84rem] overflow-hidden rounded-[1.75rem] border border-akiba-line bg-white sm:rounded-[2.25rem]">
      <div className="grid gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1fr_auto_auto_auto] lg:px-14">
        <div className="max-w-md">
          <Logo />
          <p className="mt-5 text-sm leading-6 text-akiba-muted">
            Find the good places. Get rewarded for going. Shops near you, Miles on what you spend, and a nudge before an offer starts.
          </p>
          <p className="mt-3 text-xs text-akiba-muted/60">
            Built by Akiba Ecosystems Ltd. Not operated by MiniPay or Opera.
          </p>
        </div>
        <div>
          <h2 className="font-sterling text-lg font-medium text-akiba-ink">Platform</h2>
          <div className="mt-4 flex flex-col gap-3">
            {[
              { label: "Get Akiba Pass", href: siteConfig.passUrl },
              { label: "For Merchants", href: "/merchants" },
              { label: "Mini-App", href: siteConfig.appUrl },
              { label: "About", href: "/about" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-akiba-muted no-underline hover:text-akiba-teal"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-sterling text-lg font-medium text-akiba-ink">Developers</h2>
          <div className="mt-4 flex flex-col gap-3">
            {[
              { label: "API Overview", href: "/developers" },
              { label: "Integration Options", href: "/developers#integration" },
              { label: "Voucher API", href: "/developers#capabilities" },
              { label: "Authentication", href: "/developers#auth" },
              { label: "Request API Access", href: "/developers#contact" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-akiba-muted no-underline hover:text-akiba-teal"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-sterling text-lg font-medium text-akiba-ink">Connect</h2>
          <div className="mt-4 flex flex-col gap-3">
            <Link href="/support" className="text-sm text-akiba-muted no-underline hover:text-akiba-teal">
              App support
            </Link>
            <a
              href={siteConfig.xUrl}
              className="inline-flex items-center gap-2 text-sm text-akiba-muted no-underline hover:text-akiba-teal"
            >
              <Twitter className="h-4 w-4" />
              AkibaMiles
            </a>
            <a
              href={siteConfig.telegramUrl}
              className="inline-flex items-center gap-2 text-sm text-akiba-muted no-underline hover:text-akiba-teal"
            >
              <Send className="h-4 w-4" />
              Telegram
            </a>
            <a
              href={`mailto:${siteConfig.email}`}
              className="inline-flex items-center gap-2 text-sm text-akiba-muted no-underline hover:text-akiba-teal"
            >
              <Mail className="h-4 w-4" />
              {siteConfig.email}
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-akiba-line bg-akiba-paper">
        <div className="flex flex-col gap-3 px-6 py-5 text-sm text-akiba-muted sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-14">
          <p>© {new Date().getFullYear()} AkibaMiles</p>
          <div className="flex gap-4">
            <Link href="/privacy-policy" className="no-underline hover:text-akiba-teal">
              Privacy Policy
            </Link>
            <Link href="/terms-of-use" className="no-underline hover:text-akiba-teal">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
      </div>
    </footer>
  );
}
