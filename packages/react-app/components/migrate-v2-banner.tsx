"use client";

import { useEffect, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import { celo } from "viem/chains";
import MiniMilesAbi from "@/contexts/minimiles.json";
import { Button } from "@/components/ui/button";

const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";

const V1_ADDRESS = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b" as const;

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

type Props = {
  address: string;
  onMigrated?: () => void;
};

type State = "checking" | "none" | "idle" | "loading" | "done" | "error";

export function MigrateV2Banner({ address, onMigrated }: Props) {
  const [state, setState] = useState<State>("checking");
  const [v1Balance, setV1Balance] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!address) return;
    publicClient
      .readContract({
        address: V1_ADDRESS,
        abi: MiniMilesAbi.abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })
      .then((raw) => {
        const num = parseFloat(formatUnits(raw as bigint, 18));
        setV1Balance(num);
        setState(num > 0 ? "idle" : "none");
      })
      .catch(() => setState("none"));
  }, [address]);

  if (state === "checking" || state === "none" || state === "done") return null;

  async function handleMigrate() {
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/migrate/claim-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Migration failed");
      }

      setState("done");
      window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
      onMigrated?.();
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong");
      setState("error");
    }
  }

  const formattedBalance = v1Balance.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  return (
    <div className="relative mx-4 mt-4 rounded-[16px] bg-[#FFF7ED] p-4 shadow-[0_6px_8px_0_rgba(0,0,0,0.12)] overflow-hidden">
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-[16px] bg-[#F59E0B]" />

      <div className="pl-3">
        <p className="text-sm font-semibold text-[#92400E]">
          Upgrade your Miles to V2
        </p>
        <p className="mt-1 text-sm text-[#78350F]">
          You have{" "}
          <span className="font-bold">{formattedBalance} Miles</span> on the old
          contract. Migrate to V2 for free — we cover the gas.
        </p>

        {state === "error" && (
          <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
        )}

        <Button
          type="button"
          title="Migrate to V2"
          onClick={handleMigrate}
          loading={state === "loading"}
          widthFull
          className="mt-3 h-10 rounded-[12px] bg-[#F59E0B] text-sm font-semibold text-white hover:bg-[#D97706]"
        />
      </div>
    </div>
  );
}
