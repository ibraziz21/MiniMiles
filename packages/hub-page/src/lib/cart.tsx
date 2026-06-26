"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type CartItem = {
  id: string;           // product_id
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  merchantWallet: string | null;
  name: string;
  price: number;        // price_cusd
  category: string;
  imageUrl: string | null;
  qty: number;
};

type CartState = {
  items: CartItem[];
  merchantId: string | null;
};

type CartCtx = {
  items: CartItem[];
  merchantId: string | null;
  merchantName: string | null;
  count: number;
  subtotal: number;
  add: (item: Omit<CartItem, "qty">) => "added" | "switched";
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
  confirmSwitch: (item: Omit<CartItem, "qty">) => void;
};

const CartContext = createContext<CartCtx | null>(null);
const STORAGE_KEY = "akiba_cart_v1";

const EMPTY: CartState = { items: [], merchantId: null };

function load(): CartState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(state: CartState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);

  useEffect(() => {
    setState(load());
  }, []);

  const update = useCallback((next: CartState) => {
    setState(next);
    save(next);
  }, []);

  function add(item: Omit<CartItem, "qty">): "added" | "switched" {
    const current = load();
    // Different merchant — caller must call confirmSwitch to proceed
    if (current.merchantId && current.merchantId !== item.merchantId) {
      return "switched";
    }
    const existing = current.items.find((i) => i.id === item.id);
    const next: CartState = {
      merchantId: item.merchantId,
      items: existing
        ? current.items.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i)
        : [...current.items, { ...item, qty: 1 }],
    };
    update(next);
    return "added";
  }

  function confirmSwitch(item: Omit<CartItem, "qty">) {
    const next: CartState = {
      merchantId: item.merchantId,
      items: [{ ...item, qty: 1 }],
    };
    update(next);
  }

  function remove(productId: string) {
    const current = load();
    const items = current.items.filter((i) => i.id !== productId);
    update({ merchantId: items.length ? current.merchantId : null, items });
  }

  function setQty(productId: string, qty: number) {
    if (qty <= 0) { remove(productId); return; }
    const current = load();
    update({ ...current, items: current.items.map((i) => i.id === productId ? { ...i, qty } : i) });
  }

  function clear() {
    update(EMPTY);
  }

  const count = state.items.reduce((s, i) => s + i.qty, 0);
  const subtotal = state.items.reduce((s, i) => s + i.price * i.qty, 0);
  const merchantName = state.items[0]?.merchantName ?? null;

  return (
    <CartContext.Provider value={{
      items: state.items, merchantId: state.merchantId, merchantName,
      count, subtotal, add, remove, setQty, clear, confirmSwitch,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
