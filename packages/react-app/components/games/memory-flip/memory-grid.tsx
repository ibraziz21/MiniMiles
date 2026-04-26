"use client";

import { MemoryCard } from "./memory-card";

export function MemoryGrid({
  deck,
  revealed,
  matched,
  onFlip,
  disabled,
}: {
  deck: Array<{ id: string; value: string }>;
  revealed: Set<number>;
  matched: Set<number>;
  onFlip: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-3 px-4">
      {deck.map((card, index) => (
        <MemoryCard
          key={card.id}
          value={card.value}
          visible={revealed.has(index) || matched.has(index)}
          matched={matched.has(index)}
          disabled={disabled}
          onClick={() => onFlip(index)}
        />
      ))}
    </div>
  );
}
