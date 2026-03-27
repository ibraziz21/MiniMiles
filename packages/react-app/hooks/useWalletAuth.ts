"use client";

import { useState, useEffect, useCallback } from "react";

function buildMessage(address: string, nonce: string): string {
  return [
    "Sign in to MiniMiles",
    "",
    "This request does not trigger a blockchain transaction or cost any fees.",
    "",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

export type AuthState = "unknown" | "unauthenticated" | "signing" | "authenticated" | "error";

export function useWalletAuth(address: string | null) {
  const [authState, setAuthState] = useState<AuthState>("unknown");

  // Check existing session on mount / address change
  useEffect(() => {
    if (!address) {
      setAuthState("unauthenticated");
      return;
    }
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated && data.walletAddress === address.toLowerCase()) {
          setAuthState("authenticated");
        } else {
          setAuthState("unauthenticated");
        }
      })
      .catch(() => setAuthState("unauthenticated"));
  }, [address]);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!address || typeof window === "undefined" || !window.ethereum) return false;
    setAuthState("signing");

    try {
      // 1. Get nonce from server
      const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce } = await nonceRes.json();

      // 2. Build message and sign with wallet
      const message = buildMessage(address, nonce);
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      });

      // 3. Send to server for verification
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, message, signature }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        console.error("[useWalletAuth] verify failed:", err);
        setAuthState("error");
        return false;
      }

      setAuthState("authenticated");
      return true;
    } catch (err: any) {
      // User rejected the signature request
      if (err?.code === 4001) {
        setAuthState("unauthenticated");
      } else {
        console.error("[useWalletAuth]", err);
        setAuthState("error");
      }
      return false;
    }
  }, [address]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setAuthState("unauthenticated");
  }, []);

  return { authState, signIn, signOut, isAuthenticated: authState === "authenticated" };
}
