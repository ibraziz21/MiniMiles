import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { CartButton } from "@/components/CartButton";
import { createClient } from "@/lib/supabase/server";
import { User } from "lucide-react";

export async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-akiba-ink">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo dark />

        {/* Desktop nav tabs */}
        <nav className="hidden items-center gap-6 sm:flex">
          <NavLinks dark />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <CartButton />
          {user ? (
            <a
              href="/me"
              className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
            >
              <User className="h-4 w-4" />
              <span className="hidden max-w-[120px] truncate sm:block">{user.email}</span>
            </a>
          ) : (
            <a
              href="/login"
              className="inline-flex h-9 items-center rounded-full bg-akiba-teal px-4 text-sm font-semibold text-white no-underline transition hover:bg-[#1E7E8D]"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
