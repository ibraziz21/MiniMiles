import { describe, expect, it } from "vitest";
import { GET as getOrders, POST as createOrder } from "@/app/api/shop/orders/route";
import { GET as getRecoverableOrders } from "@/app/api/shop/orders/recoverable/route";
import { POST as recoverOrder } from "@/app/api/shop/orders/recover/route";
import { POST as confirmOrder } from "@/app/api/shop/orders/[id]/confirm/route";
import { POST as disputeOrder } from "@/app/api/shop/orders/[id]/dispute/route";
import { GET as getLegacyMerchants } from "@/app/api/shop/merchants/route";
import { GET as getLegacyMerchant } from "@/app/api/shop/merchants/[slug]/route";
import { GET as getLegacyMerchantWallet } from "@/app/api/shop/merchants/[slug]/wallet/route";
import { POST as initiateMpesa } from "@/app/api/payments/mpesa/initiate/route";

const retiredHandlers = [
  ["list orders", getOrders],
  ["create order", createOrder],
  ["list recoverable orders", getRecoverableOrders],
  ["recover order", recoverOrder],
  ["confirm order", confirmOrder],
  ["dispute order", disputeOrder],
  ["legacy merchant list", getLegacyMerchants],
  ["legacy merchant detail", getLegacyMerchant],
  ["legacy merchant wallet", getLegacyMerchantWallet],
  ["M-Pesa initiation", initiateMpesa],
] as const;

describe("direct-commerce retirement boundary", () => {
  it.each(retiredHandlers)("returns a stable 410 for %s", async (_name, handler) => {
    const response = handler();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ error: "direct-commerce-retired" });
  });
});
