import Link from "next/link";
import { Mail, Send, Twitter } from "lucide-react";
import { Logo } from "@/components/Logo";
import { navLinks, siteConfig } from "@/content/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-akiba-line bg-white">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_auto_auto] lg:px-8">
        <div className="max-w-md">
          <Logo />
          <p className="mt-5 text-sm leading-6 text-akiba-muted">
            AkibaMiles is built by EcoLabs and is not operated by MiniPay or Opera.
          </p>
        </div>
        <div>
          <h2 className="font-sterling text-lg font-medium text-akiba-ink">Explore</h2>
          <div className="mt-4 flex flex-col gap-3">
            {navLinks.map((item) => (
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
          <h2 className="font-sterling text-lg font-medium text-akiba-ink">Follow Us</h2>
          <div className="mt-4 flex flex-col gap-3">
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
      <div className="border-t border-akiba-line">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 text-sm text-akiba-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
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
    </footer>
  );
}
