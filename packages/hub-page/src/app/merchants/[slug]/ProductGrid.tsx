"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ShoppingBag } from "lucide-react";
import { AddToCart } from "@/app/shop/[slug]/AddToCart";
import type { PublicStorefrontProduct } from "@/lib/merchants/types";

const PAGE_SIZE = 4;

/**
 * A 2x2 (mobile) / 1x4 (sm+) page of products that comfortably fits the
 * screen without scrolling. Categories with more than `PAGE_SIZE` products
 * page through the rest instead of growing into one long scroll.
 */
export function ProductGrid({
  products,
  merchant,
}: {
  products: PublicStorefrontProduct[];
  merchant: { id: string; slug: string; name: string };
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(products.length / PAGE_SIZE);
  const visible = products.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {visible.map((product) => (
          <div key={product.id} className="flex flex-col overflow-hidden rounded-xl border border-akiba-line bg-white">
            <div className="flex h-20 items-center justify-center bg-akiba-card">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <ShoppingBag className="h-6 w-6 text-akiba-muted" />
              )}
            </div>
            <div className="flex flex-1 flex-col p-2">
              <h4 className="line-clamp-1 text-xs font-semibold text-akiba-ink">{product.name}</h4>
              <span className="mt-0.5 font-sterling text-sm font-semibold text-akiba-ink">${product.priceCusd.toFixed(2)}</span>
              <AddToCart
                compact
                product={{
                  id: product.id, name: product.name, price: product.priceCusd,
                  category: product.category, imageUrl: product.imageUrl, productType: product.productType,
                }}
                merchant={merchant}
              />
            </div>
          </div>
        ))}
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous products"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-akiba-line text-akiba-ink transition hover:border-akiba-teal/40 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium text-akiba-muted">
            Page {page + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            aria-label="Next products"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-akiba-line text-akiba-ink transition hover:border-akiba-teal/40 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
