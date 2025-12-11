"use client";

import type { FC, FormEvent } from "react";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string | null;
  onConfirmed: (username: string) => void;
};

type Status =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "error";

export const ProsperityPassUsernameSheet: FC<Props> = ({
  open,
  onOpenChange,
  address,
  onConfirmed,
}) => {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const disabled = !address || status === "checking";

  const validateLocal = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      return "Username must be between 3 and 20 characters.";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return "Use only letters, numbers, or underscores.";
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address) return;

    const trimmed = value.trim();
    const localErr = validateLocal(trimmed);
    if (localErr) {
      setStatus("invalid");
      setMessage(localErr);
      return;
    }

    setStatus("checking");
    setMessage("Checking availability…");

    try {
      const res = await fetch("/api/user/set-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          username: trimmed,
        }),
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        setStatus("taken");
        setMessage(body?.error || "That username is already taken.");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus("error");
        setMessage(
          body?.error || "Something went wrong while saving your username."
        );
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        username?: string;
      };

      const finalUsername = (body?.username ?? trimmed).toLowerCase();

      setStatus("available");
      setMessage("Username saved!");

      // Let parent start the claim flow now that username is reserved
      onConfirmed(finalUsername);
      onOpenChange(false);
    } catch (err) {
      console.error("[UsernameSheet] set-username failed:", err);
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const statusColor =
    status === "available"
      ? "text-green-600"
      : status === "taken" || status === "invalid" || status === "error"
      ? "text-red-600"
      : "text-gray-500";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          fixed
          inset-x-0
          mx-auto
          w-full
          max-w-[420px]
          rounded-t-[24px]
          rounded-b-none
          border-none
          bg-white
          shadow-[0_-10px_30px_rgba(0,0,0,0.15)]
          focus:outline-none
          data-[state=open]:animate-none
        "
        style={{
          top: "auto",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <div className="px-6 pt-6 pb-8">
          {/* drag handle */}
          <div className="mb-6 flex justify-center">
            <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
          </div>

          <div className="mx-auto flex w-full max-w-[312px] flex-col gap-4">
            <div>
              <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
                Choose your Akiba username
              </h2>
              <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
                Pick a unique username to use with your Prosperity Pass. It will
                appear as <span className="font-mono">username.akiba</span>.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#374151]">
                  Username
                </label>
                <div className="flex items-center rounded-[12px] border border-[#D1D5DB] px-3 py-2">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setStatus("idle");
                      setMessage(null);
                    }}
                    placeholder="e.g. ibra"
                    className="
                      flex-1
                      border-none
                      bg-transparent
                      text-[16px]
                      leading-[22px]
                      text-[#111827]
                      outline-none
                    "
                  />
                  <span className="ml-1 text-[14px] text-[#6B7280]">
                    .akiba
                  </span>
                </div>
              </div>

              {message && (
                <p className={`text-xs mt-1 ${statusColor}`}>{message}</p>
              )}

              <button
                type="submit"
                disabled={disabled}
                className={`
                  mt-2
                  h-12
                  w-full
                  rounded-[16px]
                  text-base
                  font-medium
                  ${
                    disabled
                      ? "bg-[#D4D4D4] text-white"
                      : "bg-[#238D9D] text-white"
                  }
                `}
              >
                {status === "checking" ? "Checking…" : "Save & continue"}
              </button>

              <p className="mt-1 text-[12px] leading-[16px] text-[#9CA3AF]">
                Usernames can contain letters, numbers, and underscores, and
                must be 3–20 characters long.
              </p>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
