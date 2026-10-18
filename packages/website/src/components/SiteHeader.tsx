import Link from "next/link";
import { siteConfig, navLinks } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { Logo } from "@/components/Logo";

/**
 * Floating capsule nav: the bar is an inset pill rather than a full-width
 * band, so it sits on the paper page the same way the section panels do.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pb-2 pt-3 sm:px-5 sm:pt-5">
      {/* Fades the page out behind the floating pill as it scrolls under. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-akiba-paper via-akiba-paper/85 to-transparent"
        aria-hidden="true"
      />
      <div className="mx-auto w-full max-w-[84rem] rounded-full border border-akiba-line bg-white/85 px-3 py-2 shadow-chip backdrop-blur-md sm:px-4">
        <div className="flex items-center justify-between gap-4">
          <div className="pl-1">
            <Logo />
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-2 text-sm font-medium text-akiba-muted no-underline transition hover:bg-akiba-tint hover:text-akiba-teal"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ButtonLink
              href="/merchants"
              variant="secondary"
              className="hidden px-4 py-2.5 text-sm lg:inline-flex"
            >
              For Merchants
            </ButtonLink>
            <ButtonLink href={siteConfig.passUrl} className="px-4 py-2.5 text-sm">
              Get Akiba Pass
            </ButtonLink>
          </div>
        </div>
      </div>

      <nav
        className="no-scrollbar mx-auto mt-2 flex w-full max-w-[84rem] gap-2 overflow-x-auto md:hidden"
        aria-label="Mobile navigation"
      >
        {navLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-full border border-akiba-line bg-white/85 px-4 py-2 text-sm font-medium text-akiba-muted no-underline backdrop-blur-md"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
