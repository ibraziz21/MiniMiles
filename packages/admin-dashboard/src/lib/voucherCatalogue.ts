import "server-only";
import { supabase } from "@/lib/supabase";
export type VoucherOffer = {
  id: string;
  partner_id: string;
  title: string;
  description: string | null;
  miles_cost: number;
  active: boolean;
  lifecycle_state: string;
  start_at: string | null;
  end_at: string | null;
  expires_at: string | null;
  global_cap: number | null;
  funding_mode: string;
  voucher_type: string;
  discount_kes: number | null;
  discount_percent: number | null;
  minimum_spend_kes: number | null;
  maximum_discount_kes: number | null;
  access_policy: string | null;
  acquisition_mode: string | null;
  max_claims_per_customer: number | null;
  claim_validity_seconds: number | null;
  terms_text: string | null;
  funding_allocation_id: string | null;
  rules: Record<string, unknown> | null;
};
export type VoucherMerchant = {
  id: string;
  name: string;
  country: string | null;
  banner_url: string | null;
  logo_url: string | null;
  image_url: string | null;
};
export type VoucherActivity = {
  id: string;
  voucher_template_id: string;
  status: string;
  created_at: string;
  redeemed_at: string | null;
  expires_at: string | null;
  funding_allocation_id: string | null;
};
export const offerFields =
  "id,partner_id,title,description,miles_cost,active,lifecycle_state,start_at,end_at,expires_at,global_cap,funding_mode,voucher_type,discount_kes,discount_percent,minimum_spend_kes,maximum_discount_kes,access_policy,acquisition_mode,max_claims_per_customer,claim_validity_seconds,terms_text,funding_allocation_id,rules";
export function coreVoucherQuery() {
  return supabase
    .from("spend_voucher_templates")
    .select(offerFields)
    .not("partner_id", "is", null)
    .is("discount_cusd", null)
    .is("retail_value_cusd", null)
    .is("wholesale_price_cusd", null)
    .or("settlement_currency.is.null,settlement_currency.eq.KES");
}
export { readAllRows as voucherReadAll } from "./readAllRows";
import { readAllRows as voucherReadAll } from "./readAllRows";
export async function loadVoucherCatalogue() {
  const offers = (await voucherReadAll((from, to) =>
    coreVoucherQuery()
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  )) as VoucherOffer[];
  const partnerIds = [...new Set(offers.map((v) => v.partner_id))],
    ids = offers.map((v) => v.id);
  const chunks = <T>(values: T[]) =>
    Array.from({ length: Math.ceil(values.length / 100) }, (_, i) =>
      values.slice(i * 100, i * 100 + 100)
    );
  const [merchants, locations, activity] = await Promise.all([
    Promise.all(
      chunks(partnerIds).map((chunk) =>
        voucherReadAll((from, to) =>
          supabase
            .from("partners")
            .select("id,name,country,banner_url,logo_url,image_url")
            .in("id", chunk)
            .order("id")
            .range(from, to)
        )
      )
    ).then((rows) => rows.flat() as VoucherMerchant[]),
    Promise.all(
      chunks(partnerIds).map((chunk) =>
        voucherReadAll((from, to) =>
          supabase
            .from("merchant_locations")
            .select("partner_id,locality,city")
            .in("partner_id", chunk)
            .eq("is_primary", true)
            .eq("active", true)
            .order("id")
            .range(from, to)
        )
      )
    ).then((rows) => rows.flat()),
    Promise.all(
      chunks(ids).map((chunk) =>
        voucherReadAll((from, to) =>
          supabase
            .from("issued_vouchers")
            .select(
              "id,voucher_template_id,status,created_at,redeemed_at,expires_at,funding_allocation_id"
            )
            .in("voucher_template_id", chunk)
            .order("id")
            .range(from, to)
        )
      )
    ).then((rows) => rows.flat() as VoucherActivity[]),
  ]);
  return { offers, merchants, locations, activity };
}
export async function voucherCodeMatches(query: string) {
  if (!query) return new Set<string>();
  const rows = await voucherReadAll((from, to) =>
    supabase
      .from("issued_vouchers")
      .select("voucher_template_id")
      .ilike("code", `%${query.replaceAll("%", "").replaceAll("_", "")}%`)
      .order("id")
      .range(from, to)
  );
  return new Set(rows.map((row) => row.voucher_template_id));
}
