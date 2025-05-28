// components/MiniMilesHeader.tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function MiniMilesHeader({
  total,
  filter,
  setFilter,
}: {
  total: number;
  filter: string;
  setFilter: (val: string) => void;
}) {
  return (
    <div className="px-4 pt-4">
      <h2 className="text-lg font-medium">Mini miles: Earn</h2>
      <p className="text-xl font-medium mt-2">Total MiniMiles Earned: {total.toLocaleString()}</p>

      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(val) => setFilter(val || "active")}
        className="mt-4 gap-2"
      >
        <ToggleGroupItem value="active" className="rounded-full px-4">
          Active
        </ToggleGroupItem>
        <ToggleGroupItem value="completed" className="rounded-full px-4">
          Completed
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
