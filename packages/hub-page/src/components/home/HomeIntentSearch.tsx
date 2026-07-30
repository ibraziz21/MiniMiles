"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { track } from "@/lib/analytics/track";

const MAX_QUERY_LENGTH = 120;
const RECENT_SEARCHES_KEY = "akiba:home:recent_searches";
const MAX_RECENT = 5;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(query: string) {
  if (typeof window === "undefined") return;
  const current = loadRecent().filter((q) => q.toLowerCase() !== query.toLowerCase());
  const next = [query, ...current].slice(0, MAX_RECENT);
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
}

export function HomeIntentSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  function submit(query: string) {
    const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!trimmed) return;
    saveRecent(trimmed);
    // Only the query length is sent to general analytics — never raw text.
    track("home_search_submit", { query_length: trimmed.length, results_source: "merchants" });
    setFocused(false);
    inputRef.current?.blur();
    router.push(`/merchants?q=${encodeURIComponent(trimmed)}&from=home`);
  }

  return (
    <div className="relative">
      <label htmlFor="home-intent-search" className="sr-only">
        Search merchants or what you need
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-akiba-muted" />
        <input
          id="home-intent-search"
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(value);
          }}
          className="w-full rounded-2xl border border-akiba-line bg-white py-3.5 pl-12 pr-12 text-base outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus:border-akiba-teal"
        />
        {value && (
          <button
            aria-label="Clear search"
            onClick={() => setValue("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-akiba-muted hover:text-akiba-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {focused && !value && recent.length > 0 && (
        <div className="absolute inset-x-0 top-full z-10 mt-1.5 rounded-2xl border border-akiba-line bg-white p-2 shadow-soft">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-akiba-muted">Recent</p>
          {recent.map((q) => (
            <button
              key={q}
              onMouseDown={() => submit(q)}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-akiba-ink hover:bg-akiba-card"
            >
              <Search className="h-3.5 w-3.5 text-akiba-muted" /> {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
