"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, User, LogOut } from "lucide-react";
import { BrandMark } from "@/components/layout/BrandMark";
import { useCommandSearchTrigger } from "@/components/shell/search-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
export function MerchantAdminHeader({
  title,
  backHref,
  name,
  role,
  directory = false,
}: {
  title: string;
  backHref?: string;
  name?: string | null;
  role: string;
  directory?: boolean;
}) {
  const search = useCommandSearchTrigger(),
    router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex min-h-[72px] items-center gap-3 bg-[#FAF8FF]/95 px-4 py-3 shadow-[0_5px_14px_rgba(19,27,46,0.04)] backdrop-blur sm:px-6">
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      ) : (
        <Link
          href="/overview"
          aria-label="Akiba admin home"
          className="flex h-10 w-10 items-center justify-center rounded-control bg-primary text-white"
        >
          <BrandMark className="h-7 w-7" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        {directory ? (
          <>
            <p className="text-lg font-semibold tracking-tight">Akiba Admin</p>
            <p className="text-sm text-primary-strong">Merchant Directory</p>
          </>
        ) : (
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        )}
      </div>
      {directory && (
        <button
          onClick={search}
          aria-label="Search"
          className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Search className="h-5 w-5" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Merchant page account menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#005C55] text-white focus-visible:ring-2 focus-visible:ring-primary"
          >
            <User className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {name || "Admin"}
            <span className="block text-xs font-normal capitalize text-ink-muted">
              {role.replaceAll("_", " ")}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
