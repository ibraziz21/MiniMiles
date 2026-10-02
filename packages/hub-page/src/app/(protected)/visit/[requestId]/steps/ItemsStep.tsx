import type { RefObject } from "react";
import type { Item } from "./types";

export function ItemsStep({
  prompt,
  items,
  itemDraft,
  maxItems,
  onDraftChange,
  onAdd,
  onRemove,
  onBack,
  onNext,
  headingRef,
}: {
  prompt: string;
  items: Item[];
  itemDraft: string;
  maxItems: number;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (clientItemKey: string) => void;
  onBack: () => void;
  onNext: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {prompt}
      </h1>
      <div className="flex gap-2">
        <label htmlFor="item-draft" className="sr-only">
          Item name
        </label>
        <input
          id="item-draft"
          value={itemDraft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          maxLength={80}
          placeholder="e.g. Spanish Latte"
          className="min-h-[44px] flex-1 rounded-xl border border-akiba-line px-4 text-base text-akiba-ink"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!itemDraft.trim() || items.length >= maxItems}
          className="min-h-[44px] rounded-xl bg-akiba-teal px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item.clientItemKey}
            className="flex items-center gap-2 rounded-full border border-akiba-line bg-white px-3 py-2 text-sm text-akiba-ink"
          >
            {item.rawLabel}
            <button
              type="button"
              onClick={() => onRemove(item.clientItemKey)}
              aria-label={`Remove ${item.rawLabel}`}
              className="text-akiba-muted"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-akiba-muted">Up to {maxItems} items. You can also skip this.</p>
      <div className="mt-auto flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="min-h-[44px] text-sm font-medium text-akiba-muted">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="min-h-[48px] flex-1 rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white"
        >
          {items.length > 0 ? "Continue" : "Skip"}
        </button>
      </div>
    </section>
  );
}
