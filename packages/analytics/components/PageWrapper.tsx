"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./Sidebar";

interface PageWrapperProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  onRefresh: () => void;
  lastUpdated: Date | null;
  loading?: boolean;
}

export default function PageWrapper({
  children,
  title,
  subtitle,
  onRefresh,
  lastUpdated,
  loading = false,
}: PageWrapperProps) {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const secret = sessionStorage.getItem("analytics_secret");
    if (!secret) {
      router.replace("/login");
    } else {
      setAuthChecked(true);
    }
  }, [router]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Checking authentication...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-900">
      <Sidebar />
      <main className="flex-1 ml-64 min-h-screen">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">{title}</h1>
              {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-4">
              {lastUpdated && (
                <span className="text-xs text-gray-500">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={onRefresh}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-gray-600 transition-all disabled:opacity-50"
              >
                <span className={loading ? "animate-spin" : ""}>🔄</span>
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
