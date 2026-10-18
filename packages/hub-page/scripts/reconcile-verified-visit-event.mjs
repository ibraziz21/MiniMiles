#!/usr/bin/env node

/**
 * One-event recovery for missed scan-award -> Hub delivery.
 *
 * Dry-run by default. Pass --apply only after reviewing the aggregate plan.
 * Required environment:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *   RECONCILE_MERCHANT_ID, RECONCILE_FROM, RECONCILE_TO
 *
 * Dates are ISO instants and the interval is [from, to). The script never
 * prints emails, Auth ids or canonical ids.
 */
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
const merchantId = process.env.RECONCILE_MERCHANT_ID?.trim();
const from = process.env.RECONCILE_FROM?.trim();
const to = process.env.RECONCILE_TO?.trim();

if (!url || !serviceKey || !merchantId || !from || !to) {
  throw new Error("Supabase credentials, merchant id and reconciliation interval are required");
}
if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
  throw new Error("RECONCILE_FROM and RECONCILE_TO must form a valid increasing ISO interval");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isEligiblePurchase(purchase) {
  const miles = Number(purchase.miles_awarded);
  const net = Number(purchase.net_miles_awarded);
  const reversed = Number(purchase.miles_reversed ?? 0);
  return Boolean(
    purchase.canonical_id &&
    purchase.status === "rewarded" &&
    Number.isSafeInteger(miles) && miles > 0 &&
    Number.isFinite(net) && net > 0 &&
    Number.isFinite(reversed) && reversed <= 0 &&
    !["refunded", "reversed", "fully_refunded"].includes(purchase.refund_status ?? "") &&
    purchase.raw_metadata?.channel === "in_store"
  );
}

async function allAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

const { data: merchant, error: merchantError } = await admin
  .from("partners")
  .select("id, name")
  .eq("id", merchantId)
  .single();
if (merchantError) throw merchantError;

const { data: purchaseRows, error: purchaseError } = await admin
  .from("purchase_events")
  .select("id, canonical_id, merchant_id, external_purchase_id, source_app, occurred_at, raw_metadata, status, miles_awarded, net_miles_awarded, miles_reversed, refund_status, amount, currency")
  .eq("merchant_id", merchantId)
  .gte("occurred_at", from)
  .lt("occurred_at", to)
  .order("occurred_at", { ascending: true })
  .limit(1000);
if (purchaseError) throw purchaseError;

const purchases = (purchaseRows ?? []).filter(isEligiblePurchase);
const purchaseIds = purchases.map((purchase) => purchase.id);
const { data: identityRows, error: identityError } = purchaseIds.length > 0
  ? await admin
      .from("purchase_event_identities")
      .select("purchase_event_id, identity_type, identity_value, canonical_id")
      .in("purchase_event_id", purchaseIds)
      .eq("identity_type", "email")
  : { data: [], error: null };
if (identityError) throw identityError;

const eventEmails = [...new Set((identityRows ?? []).map((row) => normalizedEmail(row.identity_value)).filter(Boolean))];
const eventCanonicalIds = [...new Set((identityRows ?? []).map((row) => row.canonical_id))];
const authUsers = await allAuthUsers();
const relevantAuthUserIds = authUsers
  .filter((user) => eventEmails.includes(normalizedEmail(user.email)))
  .map((user) => user.id);
const [hubMappingsResult, emailLinksResult] = await Promise.all([
  eventCanonicalIds.length > 0 || relevantAuthUserIds.length > 0
    ? admin
        .from("hub_user_canonicals")
        .select("hub_user_id, canonical_id")
        .or([
          eventCanonicalIds.length > 0 ? `canonical_id.in.(${eventCanonicalIds.join(",")})` : null,
          relevantAuthUserIds.length > 0 ? `hub_user_id.in.(${relevantAuthUserIds.join(",")})` : null,
        ].filter(Boolean).join(","))
    : Promise.resolve({ data: [], error: null }),
  eventEmails.length > 0
    ? admin
        .from("identity_links")
        .select("canonical_id, identity_type, identity_value")
        .eq("identity_type", "email")
        .in("identity_value", eventEmails)
    : Promise.resolve({ data: [], error: null }),
]);
if (hubMappingsResult.error) throw hubMappingsResult.error;
if (emailLinksResult.error) throw emailLinksResult.error;

const authByEmail = new Map(authUsers.map((user) => [normalizedEmail(user.email), user]));
const mappingByUser = new Map((hubMappingsResult.data ?? []).map((row) => [row.hub_user_id, row]));
const ownerByCanonical = new Map((hubMappingsResult.data ?? []).map((row) => [row.canonical_id, row.hub_user_id]));
const linkByEmail = new Map(
  (emailLinksResult.data ?? []).map((row) => [normalizedEmail(row.identity_value), row.canonical_id]),
);
const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
const peopleByEmail = new Map();

for (const identity of identityRows ?? []) {
  const purchase = purchaseById.get(identity.purchase_event_id);
  if (!purchase || identity.canonical_id !== purchase.canonical_id) continue;
  const email = normalizedEmail(identity.identity_value);
  if (!email) continue;
  const current = peopleByEmail.get(email) ?? { email, canonicalId: identity.canonical_id, purchases: [] };
  if (current.canonicalId !== identity.canonical_id) current.conflict = "multiple_event_canonicals";
  current.purchases.push(purchase);
  peopleByEmail.set(email, current);
}

const plan = [];
for (const person of peopleByEmail.values()) {
  const authUser = authByEmail.get(person.email);
  const userMapping = authUser ? mappingByUser.get(authUser.id) : null;
  const canonicalOwner = ownerByCanonical.get(person.canonicalId);
  const emailLink = linkByEmail.get(person.email);
  let classification = "safe_repair";
  if (person.conflict) classification = person.conflict;
  else if (!authUser) classification = "no_auth_account";
  else if (!authUser.email_confirmed_at) classification = "auth_email_unconfirmed";
  else if (userMapping && userMapping.canonical_id !== person.canonicalId) classification = "auth_owns_different_canonical";
  else if (canonicalOwner && canonicalOwner !== authUser.id) classification = "event_canonical_owned_by_other_auth";
  else if (emailLink && emailLink !== person.canonicalId) classification = "email_link_conflict";
  else if (userMapping?.canonical_id === person.canonicalId) classification = "already_correct";
  plan.push({ ...person, authUser, classification });
}

const summary = Object.fromEntries(
  [...new Set(plan.map((item) => item.classification))]
    .sort()
    .map((classification) => [classification, plan.filter((item) => item.classification === classification).length]),
);

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  merchant: merchant.name,
  from,
  to,
  eligiblePurchases: purchases.length,
  distinctEventPeople: plan.length,
  classifications: summary,
}, null, 2));

if (!apply) process.exit(0);

let identityLinksCreated = 0;
let hubMappingsCreated = 0;
let verifiedEarningsCreated = 0;
let requestsCreated = 0;
const requestReasons = {};

for (const person of plan.filter((item) => ["safe_repair", "already_correct"].includes(item.classification))) {
  const { data: existingLink, error: existingLinkError } = await admin
    .from("identity_links")
    .select("canonical_id")
    .eq("identity_type", "email")
    .eq("identity_value", person.email)
    .maybeSingle();
  if (existingLinkError) throw existingLinkError;
  if (existingLink && existingLink.canonical_id !== person.canonicalId) {
    throw new Error("identity changed after dry-run; refusing to continue");
  }
  if (!existingLink) {
    const { error } = await admin.from("identity_links").insert({
      canonical_id: person.canonicalId,
      identity_type: "email",
      identity_value: person.email,
      verified_at: person.authUser.email_confirmed_at,
    });
    if (error) throw error;
    identityLinksCreated++;
  }

  const { data: existingMapping, error: existingMappingError } = await admin
    .from("hub_user_canonicals")
    .select("canonical_id")
    .eq("hub_user_id", person.authUser.id)
    .maybeSingle();
  if (existingMappingError) throw existingMappingError;
  if (existingMapping && existingMapping.canonical_id !== person.canonicalId) {
    throw new Error("Hub mapping changed after dry-run; refusing to continue");
  }
  if (!existingMapping) {
    const { error } = await admin.from("hub_user_canonicals").insert({
      hub_user_id: person.authUser.id,
      canonical_id: person.canonicalId,
    });
    if (error) throw error;
    hubMappingsCreated++;
  }

  let requestAttempted = false;
  for (const purchase of person.purchases) {
    const eventId = `purchase-event:${purchase.id}`;
    const { data: existingEvent, error: existingEventError } = await admin
      .from("verified_earning_events")
      .select("id, hub_user_id, canonical_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existingEventError) throw existingEventError;
    if (existingEvent && (existingEvent.hub_user_id !== person.authUser.id || existingEvent.canonical_id !== person.canonicalId)) {
      throw new Error("verified earning ownership conflict; refusing to continue");
    }

    let earningEventId = existingEvent?.id;
    if (!earningEventId) {
      const source = purchase.source_app === "scan_award" || purchase.raw_metadata?.source === "scan_award"
        ? "merchant_scan"
        : "merchant_purchase";
      const { data: inserted, error } = await admin
        .from("verified_earning_events")
        .insert({
          event_id: eventId,
          hub_user_id: person.authUser.id,
          canonical_id: person.canonicalId,
          partner_id: merchantId,
          source,
          channel: "in_store",
          occurred_at: purchase.occurred_at,
          purchase_event_id: purchase.id,
          paid_amount_minor: Number.isFinite(Number(purchase.amount)) ? Math.round(Number(purchase.amount) * 100) : null,
          currency: purchase.currency,
          source_item_ref: purchase.external_purchase_id || `purchase_event:${purchase.id}`,
        })
        .select("id")
        .single();
      if (error) throw error;
      earningEventId = inserted.id;
      verifiedEarningsCreated++;
    }

    if (!requestAttempted) {
      const { data: created, error } = await admin.rpc("create_discovery_contribution_request", {
        p_earning_event_id: earningEventId,
        p_hub_user_id: person.authUser.id,
        p_partner_id: merchantId,
      });
      if (error) throw error;
      const result = Array.isArray(created) ? created[0] : created;
      const reason = result?.reason ?? "unknown";
      requestReasons[reason] = (requestReasons[reason] ?? 0) + 1;
      if (result?.request_id && ["created", "already_exists"].includes(reason)) requestsCreated++;
      requestAttempted = true;
    }
  }
}

console.log(JSON.stringify({
  applied: true,
  identityLinksCreated,
  hubMappingsCreated,
  verifiedEarningsCreated,
  requestsCreated,
  requestReasons,
}, null, 2));
