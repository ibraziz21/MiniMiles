"use client";

import { useState } from "react";

const PREVIEW_CHAR_THRESHOLD = 180;

export function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PREVIEW_CHAR_THRESHOLD;

  return (
    <div className="mt-4">
      <p
        className={`whitespace-pre-line text-sm leading-relaxed text-akiba-muted ${
          expanded || !isLong ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 rounded text-sm font-semibold text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}
