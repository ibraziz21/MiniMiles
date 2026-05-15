"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GateType = "min_usdt_balance" | "prosperity_pass_holder" | "daily_5tx_completed";

export function RaffleRequirementsForm() {
  const router = useRouter();
  const [roundId, setRoundId] = useState("");
  const [mode, setMode] = useState("all");
  const [enabled, setEnabled] = useState("true");
  const [gateType, setGateType] = useState<GateType>("min_usdt_balance");
  const [minUsd, setMinUsd] = useState("10");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const gate =
      gateType === "min_usdt_balance"
        ? { type: gateType, minUsd: Number(minUsd) }
        : { type: gateType };

    try {
      const res = await fetch("/api/admin/games/raffles/requirements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: Number(roundId),
          mode,
          enabled: enabled === "true",
          gates: [gate],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save requirements");
        return;
      }
      setMessage("Requirements saved.");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <Input
          value={roundId}
          onChange={(event) => setRoundId(event.target.value)}
          placeholder="Round ID"
        />
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All gates</SelectItem>
            <SelectItem value="any">Any gate</SelectItem>
          </SelectContent>
        </Select>
        <Select value={gateType} onValueChange={(value) => setGateType(value as GateType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="min_usdt_balance">Min USDT</SelectItem>
            <SelectItem value="prosperity_pass_holder">Prosperity Pass</SelectItem>
            <SelectItem value="daily_5tx_completed">Daily 5 TX</SelectItem>
          </SelectContent>
        </Select>
        {gateType === "min_usdt_balance" && (
          <Input
            value={minUsd}
            onChange={(event) => setMinUsd(event.target.value)}
            placeholder="Min USDT"
          />
        )}
        <Select value={enabled} onValueChange={setEnabled}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Enabled</SelectItem>
            <SelectItem value="false">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Requirements"}
        </Button>
        {message && <p className="text-sm text-emerald-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
