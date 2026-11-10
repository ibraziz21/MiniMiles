"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, User, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export function VoucherHeader({
  title,
  backHref,
  name,
  role,
}: {
  title: string;
  backHref?: string;
  name?: string | null;
  role: string;
}) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex min-h-[72px] items-center gap-3 bg-[#FAF8FF]/95 px-4 py-3 backdrop-blur sm:px-6">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
        {!backHref && (
          <>
            <span className="text-primary-strong">Akiba</span>
            <span className="mx-2 font-normal text-ink-muted">/</span>
          </>
        )}
        {title}
      </h1>
      {!backHref && (
        <Link
          href="/ops-queue"
          aria-label="Review queue"
          className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Bell className="h-5 w-5" />
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Voucher page account menu"
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
