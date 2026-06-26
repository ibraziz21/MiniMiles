export type AcquisitionSource =
  | "miles_purchase"
  | "claw"
  | "raffle"
  | "giveaway"
  | "akiba_grant"
  | "merchant_grant";

export type FundingType = "miles" | "akiba" | "sponsor" | "free";

export type VoucherStatus =
  | "pending"
  | "issued"
  | "claiming"
  | "redeemed"
  | "void"
  | "expired";

/** Immutable rules snapshot stored at issue time. */
export interface RulesSnapshot {
  template_id: string;
  merchant_id: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  linked_product_id: string | null;
  retail_value_cusd: number | null;
  miles_cost: number;
  title: string;
  snapshotted_at: string;
}

export interface IssuedVoucher {
  id: string;
  code: string;
  status: VoucherStatus;
  hub_user_id: string | null;
  user_address: string;
  acquisition_source: AcquisitionSource;
  funding_type: FundingType;
  rules_snapshot: RulesSnapshot | null;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
}

/** Subset returned to clients — never exposes raw template join. */
export interface VoucherView {
  id: string;
  code: string;
  status: VoucherStatus;
  rules_snapshot: RulesSnapshot;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
}

export type IssueVoucherResult =
  | { ok: true; voucher: { id: string; code: string; status: VoucherStatus } }
  | { ok: false; error: string; httpStatus: number };

export type RedeemVoucherResult =
  | { ok: true; discountUsd: number }
  | { ok: false; error: string; httpStatus: number };
