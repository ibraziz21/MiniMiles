// components/refer-dialog.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { CopySimple, Check } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  code: string;
};

export default function ReferDialog({ open, onOpenChange, code }: Props) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const copyText = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {/* fallthrough */}
    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };
  
  const copy = useCallback(async () => {
    const ok = await copyText(code);
    if (!ok) {
      // last resort: highlight so user can long‑press
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white max-w-sm rounded-3xl p-0 overflow-hidden font-sterling">
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium">
              Refer &amp; earn
            </DialogTitle>
          </DialogHeader>

          {/* Reward info banner */}
          <div className="bg-[#238D9D] text-white rounded-xl py-4 text-center mt-4">
            <p className="text-sm opacity-80">Bonus</p>
            <p className="text-2xl font-medium">+50 AkibaMiles each</p>
          </div>

          {/* Code block */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 mb-2 ">Your code</p>
            <Input
              ref={inputRef}
              readOnly
              value={code}
              onFocus={(e) => e.target.select()}
              className="uppercase tracking-widest text-center font-semibold"
            />
          </div>

          {/* How it works */}
          <div className="mt-6 text-sm space-y-2 text-gray-700">
            <p className="font-semibold">How it works</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Share this code with a friend.</li>
              <li>They paste it during onboarding before claiming Miles.</li>
              <li>Both of you instantly receive +50 AkibaMiles.</li>
            </ol>
          </div>

          <DialogFooter className="mt-6 flex flex-col gap-3">
            <Button
              title="Copy code"
              onClick={copy}
              className="w-full bg-[#238D9D] hover:bg-[#238D9D] flex items-center justify-center gap-2"
            >
              {copied ? <Check size={18} /> : <CopySimple size={18} />}
              {copied ? "Copied!" : "Copy code"}
            </Button>

            <p className="text-xs text-gray-500 text-center">
              One-time bonus on first claim. Terms apply.
            </p>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
