"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface KeywordHit {
  word: string;
  count: number;
  answers: string[];
}

interface KeywordDrilldownProps {
  keywords: KeywordHit[];
}

export function KeywordDrilldown({ keywords }: KeywordDrilldownProps) {
  const [selectedWord, setSelectedWord] = useState(keywords[0]?.word ?? "");
  const selected = useMemo(
    () => keywords.find((keyword) => keyword.word === selectedWord) ?? keywords[0],
    [keywords, selectedWord],
  );

  if (keywords.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <button
            key={keyword.word}
            type="button"
            onClick={() => setSelectedWord(keyword.word)}
            className={cn(
              "rounded-full px-3 py-1 text-sm transition-colors",
              selected?.word === keyword.word
                ? "bg-[#238D9D] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {keyword.word} <span className={selected?.word === keyword.word ? "text-white/75" : "text-slate-400"}>({keyword.count})</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Responses mentioning “{selected.word}”</p>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
              {selected.answers.length} text{selected.answers.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {selected.answers.map((answer, index) => (
              <p key={`${selected.word}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100">
                {answer}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
