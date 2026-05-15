export type RaffleRequirementMode = "all" | "any";

export type RaffleRequirementGateType =
  | "min_usdt_balance"
  | "prosperity_pass_holder"
  | "daily_5tx_completed";

export type RaffleRequirementStatus = "passed" | "failed";

export type RaffleRequirementGateResult = {
  type: RaffleRequirementGateType;
  label: string;
  status?: RaffleRequirementStatus; // absent when eligibility hasn't been evaluated yet
  current?: string;
  required?: string;
  message?: string;
};

export type RaffleRequirementsResult = {
  roundId: number;
  gated: boolean;
  eligible: boolean | null; // null = gated but not yet evaluated (no session)
  mode: RaffleRequirementMode;
  gates: RaffleRequirementGateResult[];
  message?: string;
};
