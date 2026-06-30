/**
 * Server-only adapter — sends a verified purchase event to Akiba-Platform.
 * Platform decides whether/how many Miles to award; Hub just forwards facts.
 */

export type PurchaseEventPayload = {
  /** Merchant / partner UUID */
  merchantId: string;
  /** Stable source purchase id; normally tx_hash or mpesa_checkout_id */
  externalPurchaseId: string;
  /** Caller-supplied idempotency key for Platform dedupe */
  idempotencyKey: string;
  /** User identity for Miles issuance */
  recipient: {
    type: "wallet" | "email" | "phone";
    value: string;
  };
  /** Amount in the stated currency */
  amount: number;
  /** Currency for amount, e.g. KES or cUSD */
  currency: string;
  /** Product category string */
  productCategory?: string;
  /** Always "hub" — identifies the originating app to Platform */
  sourceApp: "hub";
  /** ISO timestamp for when Hub accepted the verified purchase */
  occurredAt: string;
  /** Additional Hub context stored on Platform raw_metadata */
  metadata?: Record<string, unknown>;
};

export type PurchaseEventResult = {
  ok: boolean;
  purchaseEventId?: string;
  rewardIssued: boolean;
  milesAwarded: number;
  reason?: string;
  error?: string;
};

const PENDING: PurchaseEventResult = {
  ok: false,
  rewardIssued: false,
  milesAwarded: 0,
  reason: "pending",
  error: "Platform unavailable",
};

export type OrderRewardStatus =
  | { state: "rewarded"; miles: number; reason?: string }
  | { state: "not_rewarded"; reason?: string }
  | { state: "pending" };

const UNAVAILABLE: OrderRewardStatus = { state: "pending" };

/**
 * Look up the Platform purchase-event for a Hub order by its idempotency key.
 * Returns a safe status — never throws into the caller.
 */
export async function getPurchaseEventForOrder(
  orderId: string
): Promise<OrderRewardStatus> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";
  if (!AKIBA_API_URL || !AKIBA_API_KEY) return UNAVAILABLE;

  const idempotencyKey = `hub-purchase-${orderId}`;
  const url = `${AKIBA_API_URL}/api/v1/purchase-events?idempotencyKey=${encodeURIComponent(idempotencyKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${AKIBA_API_KEY}` },
      // Next.js server component: opt out of cache so history is fresh
      cache: "no-store",
    });
  } catch (e) {
    console.error("[purchase-events] getPurchaseEventForOrder network error:", e);
    return UNAVAILABLE;
  }

  if (res.status === 404) return UNAVAILABLE;

  if (!res.ok) {
    console.error("[purchase-events] getPurchaseEventForOrder Platform error:", res.status);
    return UNAVAILABLE;
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json() as Record<string, unknown>;
  } catch {
    return UNAVAILABLE;
  }

  // Platform GET /purchase-events returns { success, data: [event] }. Keep
  // support for direct/nested single-event shapes for compatibility.
  const evt = normalizePurchaseEventLookup(data);
  if (!evt) return UNAVAILABLE;

  if (evt.rewardIssued === true) {
    return {
      state: "rewarded",
      miles: typeof evt.milesAwarded === "number" ? evt.milesAwarded : 0,
      ...(typeof evt.reason === "string" ? { reason: evt.reason } : {}),
    };
  }

  if (evt.rewardIssued === false) {
    return {
      state: "not_rewarded",
      ...(typeof evt.reason === "string" ? { reason: evt.reason } : {}),
    };
  }

  return UNAVAILABLE;
}

function normalizePurchaseEventLookup(data: Record<string, unknown>): Record<string, unknown> | null {
  const wrapped = data.purchaseEvent;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }

  const platformData = data.data;
  if (Array.isArray(platformData)) {
    const first = platformData[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) return null;
    return fromPlatformPurchaseEventRow(first as Record<string, unknown>);
  }

  if (platformData && typeof platformData === "object") {
    return fromPlatformPurchaseEventRow(platformData as Record<string, unknown>);
  }

  return data;
}

function fromPlatformPurchaseEventRow(row: Record<string, unknown>): Record<string, unknown> {
  const status = typeof row.status === "string" ? row.status : undefined;
  const milesAwarded =
    typeof row.miles_awarded === "number"
      ? row.miles_awarded
      : typeof row.milesAwarded === "number"
        ? row.milesAwarded
        : 0;

  if (status === "rewarded") {
    return { rewardIssued: true, milesAwarded, reason: "rewarded" };
  }

  if (status === "no_campaign" || status === "budget_exhausted") {
    return { rewardIssued: false, milesAwarded: 0, reason: status };
  }

  return row;
}

export async function sendPurchaseEvent(
  payload: PurchaseEventPayload
): Promise<PurchaseEventResult> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

  if (!AKIBA_API_URL || !AKIBA_API_KEY) {
    console.warn("[purchase-events] AKIBA_API_URL or AKIBA_API_KEY not configured — reward skipped");
    return PENDING;
  }

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API_URL}/api/v1/purchase-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AKIBA_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": payload.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[purchase-events] network error calling Platform:", e);
    return { ...PENDING, error: "Network error reaching Platform" };
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* ignore */ }
    console.error("[purchase-events] Platform returned", res.status, body);
    return {
      ...PENDING,
      error: `Platform responded ${res.status}`,
    };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json() as Record<string, unknown>;
  } catch (e) {
    console.error("[purchase-events] failed to parse Platform response:", e);
    return { ...PENDING, error: "Invalid Platform response" };
  }

  const data = body.success === true && body.data && typeof body.data === "object"
    ? body.data as Record<string, unknown>
    : body;

  return {
    ok: true,
    purchaseEventId: typeof data.purchaseEventId === "string" ? data.purchaseEventId : undefined,
    rewardIssued:    data.rewardIssued === true,
    milesAwarded:    typeof data.milesAwarded === "number" ? data.milesAwarded : 0,
    reason:          typeof data.reason === "string" ? data.reason : undefined,
  };
}
