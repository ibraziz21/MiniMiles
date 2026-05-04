"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface MerchantControlsProps {
  merchantId: string;
  storeActive: boolean | null;
}

export function MerchantControls({ merchantId, storeActive }: MerchantControlsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function setStoreActive(next: boolean) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/merchants/${merchantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_active: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update merchant");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (storeActive === null) {
    return <p className="text-sm text-slate-400">No merchant settings row exists yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        onClick={() => setStoreActive(!storeActive)}
        disabled={loading}
        variant={storeActive ? "outline" : "default"}
      >
        {loading ? "Updating..." : storeActive ? "Deactivate Store" : "Activate Store"}
      </Button>
      <p className="text-sm text-slate-500">
        {storeActive ? "Store is currently visible to users." : "Store is currently hidden from users."}
      </p>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
