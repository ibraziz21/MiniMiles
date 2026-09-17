import { NextResponse } from "next/server";

/**
 * Stable response for every retired cart, checkout, payment-initiation and
 * order endpoint. A 410 tells old clients that retrying will never create a
 * valid Akiba transaction.
 */
export function directCommerceRetired() {
  return NextResponse.json(
    {
      error: "direct-commerce-retired",
      message: "Akiba Pass no longer supports carts, checkout, payments or orders.",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
