import { Store, Globe } from "lucide-react";

/**
 * Shared "In store" / "Online" badge row — used by the merchant profile
 * header and the directory card so operating-model presentation stays in
 * one place.
 */
export function OperatingBadges({ operatingModel }: { operatingModel: string }) {
  return (
    <div className="flex gap-1.5">
      {(operatingModel === "physical" || operatingModel === "hybrid") && (
        <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-0.5 text-[11px] font-medium text-akiba-muted">
          <Store className="h-3 w-3" /> In store
        </span>
      )}
      {(operatingModel === "online" || operatingModel === "hybrid") && (
        <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-0.5 text-[11px] font-medium text-akiba-muted">
          <Globe className="h-3 w-3" /> Online
        </span>
      )}
    </div>
  );
}
