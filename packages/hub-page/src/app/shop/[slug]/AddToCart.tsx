"use client";

import { useState } from "react";
import { ShoppingBag, Plus, AlertCircle, CheckCircle2 } from "lucide-react";
import { useCart } from "@/lib/cart";

type Props = {
  product: {
    id: string;
    name: string;
    price: number;
    category: string;
    imageUrl: string | null;
    productType: "physical" | "digital";
  };
  merchant: {
    id: string;
    slug: string;
    name: string;
    walletAddress: string | null;
  };
};

export function AddToCart({ product, merchant }: Props) {
  const { add, confirmSwitch, merchantName } = useCart();
  const [state, setState] = useState<"idle" | "confirm" | "added">("idle");

  function handleAdd() {
    const result = add({
      id: product.id,
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
      merchantName: merchant.name,
      merchantWallet: merchant.walletAddress,
      name: product.name,
      price: product.price,
      category: product.category,
      imageUrl: product.imageUrl,
      productType: product.productType,
    });

    if (result === "switched") {
      setState("confirm");
    } else {
      setState("added");
      setTimeout(() => setState("idle"), 1500);
    }
  }

  function handleSwitch() {
    confirmSwitch({
      id: product.id,
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
      merchantName: merchant.name,
      merchantWallet: merchant.walletAddress,
      name: product.name,
      price: product.price,
      category: product.category,
      imageUrl: product.imageUrl,
      productType: product.productType,
    });
    setState("added");
    setTimeout(() => setState("idle"), 1500);
  }

  if (state === "confirm") {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Your cart already has a different item{merchantName ? <> from <strong>{merchantName}</strong></> : null}. Replace it with {product.name}?
        </p>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setState("idle")} className="flex-1 rounded-lg border border-amber-200 py-1.5 text-xs font-semibold text-amber-700">
            Keep cart
          </button>
          <button onClick={handleSwitch} className="flex-1 rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white">
            Start fresh
          </button>
        </div>
      </div>
    );
  }

  if (state === "added") {
    return (
      <button disabled className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-2.5 text-sm font-semibold text-white">
        <CheckCircle2 className="h-4 w-4" /> Added to cart
      </button>
    );
  }

  return (
    <button
      onClick={handleAdd}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-akiba-ink py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-teal"
    >
      <Plus className="h-4 w-4" /> Add to cart
    </button>
  );
}
