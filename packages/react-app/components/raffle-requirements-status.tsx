"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { RaffleRequirementsResult } from "@/types/raffleRequirements";

type Props = {
  loading: boolean;
  requirements: RaffleRequirementsResult | null;
};

export function RaffleRequirementsStatus({ loading, requirements }: Props) {
  if (loading) {
    return (
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Loader2 className="h-4 w-4 animate-spin text-[#238D9D]" />
          Checking requirements
        </div>
      </div>
    );
  }

  if (!requirements?.gated) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Requirements</p>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-500">
          {requirements.mode === "all" ? "Complete all" : "Complete one"}
        </span>
      </div>

      <div className="space-y-2">
        {requirements.gates.map((gate) => {
          const evaluated = gate.status !== undefined;
          const passed = gate.status === "passed";
          return (
            <div key={gate.type} className="flex items-start gap-2">
              {!evaluated ? (
                <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-gray-300" />
              ) : passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#219653]" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800">{gate.label}</p>
                {evaluated && (gate.current || gate.required) && (
                  <p className="text-[11px] text-gray-500">
                    {gate.current ?? "Not complete"}
                    {gate.required ? ` / ${gate.required}` : null}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!requirements.eligible && requirements.eligible !== null && requirements.message && (
        <p className="mt-3 text-xs font-medium text-red-600">
          {requirements.message}
        </p>
      )}
    </div>
  );
}
