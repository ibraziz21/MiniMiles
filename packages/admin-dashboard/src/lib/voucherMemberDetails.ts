import { supabase } from "@/lib/supabase";

export interface VoucherMemberDetails {
  username: string | null;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  country: string | null;
  spendMilesEarned: number;
}

interface VoucherMemberDetailsRpcRow {
  voucher_id: string;
  username: string | null;
  account_created_at: string | null;
  country: string | null;
  spend_miles_earned: number | string | null;
}

function ageInDays(createdAt: string | null): number | null {
  if (!createdAt) return null;

  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return null;

  return Math.max(0, Math.floor((Date.now() - createdAtMs) / 86_400_000));
}

export async function getVoucherMemberDetails(voucherIds: string[]): Promise<Map<string, VoucherMemberDetails>> {
  if (voucherIds.length === 0) return new Map();

  const { data, error } = await supabase.rpc("get_admin_funded_voucher_member_details", {
    p_voucher_ids: voucherIds,
  });

  if (error) {
    console.error("[admin funded vouchers] member details lookup failed:", error.message);
    return new Map();
  }

  return new Map(
    ((data ?? []) as VoucherMemberDetailsRpcRow[]).map((row) => {
      const spendMilesEarned = Number(row.spend_miles_earned ?? 0);
      return [
        row.voucher_id,
        {
          username: row.username,
          accountCreatedAt: row.account_created_at,
          accountAgeDays: ageInDays(row.account_created_at),
          country: row.country,
          spendMilesEarned: Number.isFinite(spendMilesEarned) ? spendMilesEarned : 0,
        },
      ];
    }),
  );
}
