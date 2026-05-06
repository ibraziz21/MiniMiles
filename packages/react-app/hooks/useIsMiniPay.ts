"use client";

import { useEffect, useState } from "react";
import { isMiniPayProvider } from "@/lib/minipay";

export function useIsMiniPay() {
  const [isMiniPay, setIsMiniPay] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMiniPay(isMiniPayProvider());
  }, []);

  return isMiniPay;
}
