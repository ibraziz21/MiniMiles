"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerServiceWorker } from "@/lib/sw-registration";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
