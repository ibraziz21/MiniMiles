"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Store, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { SearchResponse } from "@/app/api/admin/search/route";

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function fetchSearch(q: string): Promise<SearchResponse> {
  const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["admin-search", query],
    queryFn: () => fetchSearch(query),
    enabled: open && query.trim().length >= 2,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isTypingTarget =
        e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(true);
      } else if (e.key === "/" && !isTypingTarget) {
        e.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange]);

  const groups = [
    { key: "merchants" as const, label: "Merchants", icon: Store, items: data?.merchants ?? [] },
    { key: "members" as const, label: "Members", icon: User, items: data?.members ?? [] },
  ].filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[15%] max-w-xl translate-y-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search admin data</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchants, members…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            aria-label="Search admin data"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {query.trim().length < 2 && (
            <p className="px-2 py-6 text-center text-sm text-ink-muted">Type at least 2 characters to search.</p>
          )}
          {query.trim().length >= 2 && isFetching && (
            <p className="px-2 py-6 text-center text-sm text-ink-muted">Searching…</p>
          )}
          {query.trim().length >= 2 && !isFetching && groups.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-ink-muted">No matches for &ldquo;{query}&rdquo;.</p>
          )}
          {groups.map((group) => (
            <div key={group.key} className="mb-2 last:mb-0">
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onOpenChange(false);
                    router.push(item.href);
                  }}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-control px-2 text-left text-sm text-ink transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <group.icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
