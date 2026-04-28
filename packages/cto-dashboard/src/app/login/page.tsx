"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) router.push("/overview");
    else setError("Invalid token");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F1117]">
      <form onSubmit={submit} className="w-80 space-y-4">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-brand-light">⚡ AkibaMiles</div>
          <div className="text-sm text-gray-400 mt-1">CTO Dashboard</div>
        </div>
        <input
          type="password"
          placeholder="Dashboard token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full bg-[#1A1D27] border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-light"
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" className="w-full bg-brand hover:bg-brand-light text-white font-semibold py-3 rounded-lg text-sm transition-colors">
          Enter Dashboard
        </button>
      </form>
    </div>
  );
}
