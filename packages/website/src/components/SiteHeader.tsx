import { siteConfig, navLinks } from "@/content/site";
import { ButtonLink } from "@/components/ButtonLink";
import { Logo } from "@/components/Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-akiba-line/70 bg-akiba-paper/90 backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          {navLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-akiba-muted no-underline transition hover:text-akiba-teal"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 sm:flex">
          <ButtonLink href="/merchants" variant="secondary" className="px-4">
            For Merchants
          </ButtonLink>
          <ButtonLink href={siteConfig.passUrl} className="px-4 sm:px-5">
            Get Akiba Pass
          </ButtonLink>
        </div>
        <ButtonLink href={siteConfig.passUrl} className="px-4 sm:hidden">
          Get Akiba Pass
        </ButtonLink>
      </div>
      <nav
        className="mx-auto flex w-full max-w-7xl gap-5 overflow-x-auto border-t border-akiba-line/70 px-4 py-3 text-sm font-medium sm:hidden"
        aria-label="Mobile navigation"
      >
        {navLinks.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="whitespace-nowrap text-akiba-muted no-underline hover:text-akiba-teal"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
