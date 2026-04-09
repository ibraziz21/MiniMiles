"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight } from "lucide-react";
import { usdtSymbol, akibaMilesSymbol } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { VaultBalanceCard } from "@/components/vault-balance-card";
import { useIsMiniPay } from "@/hooks/useIsMiniPay";

const WithdrawPage = () => {
  const router = useRouter();
  const isMiniPay = useIsMiniPay();
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getUserVaultBalance, withdraw } = web3;

  const [currentDeposit, setCurrentDeposit] = useState<number>(0);
  const [amount, setAmount] = useState<string>("");
  const [loadingWithdraw, setLoadingWithdraw] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const numericAmount = useMemo(
    () => (amount ? Math.max(0, Number(amount)) : 0),
    [amount]
  );
  const withinDeposit = numericAmount > 0 && numericAmount <= currentDeposit;
  const isFullWithdraw = numericAmount > 0 && Math.abs(numericAmount - currentDeposit) < 0.000001;

  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);

  useEffect(() => {
    if (isMiniPay === true) router.replace("/earn");
  }, [isMiniPay, router]);

  useEffect(() => {
    if (!address) return;
    getUserVaultBalance?.()
      .then((b: string) => setCurrentDeposit(Number(b)))
      .catch(() => {});
  }, [address, getUserVaultBalance]);

  if (isMiniPay !== false) return null;

  const onChangeAmount = (v: string) => {
    const clean = v.replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    const safe = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
    const [int, dec] = safe.split(".");
    setAmount(dec !== undefined ? `${int}.${dec.slice(0, 6)}` : safe);
    setError(null);
  };

  const handleWithdraw = async () => {
    if (!withinDeposit) return;
    setLoadingWithdraw(true);
    setError(null);
    try {
      const res = await withdraw(String(numericAmount));
      if (res?.hash) setTxHash(res.hash);
      setCurrentDeposit((d) => Math.max(0, d - numericAmount));
      setRefreshKey((k) => k + 1);
      setSuccessOpen(true);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "Withdrawal failed. Please try again.");
    } finally {
      setLoadingWithdraw(false);
    }
  };

  const milesLost = Math.floor(numericAmount);
  const remainingMiles = Math.floor(Math.max(0, currentDeposit - numericAmount));

  return (
    <main className="min-h-screen bg-[#F8FFFE] font-sterling">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4 text-gray-600" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Withdraw from Vault</h1>
          <p className="text-xs text-gray-500">Redeem your USDT principal anytime</p>
        </div>
      </div>

      <div className="px-4 space-y-4 pb-8">
        {/* Balance card */}
        <VaultBalanceCard refreshKey={refreshKey} hideActions />

        {/* Withdraw input card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-3">Amount to withdraw (USDT)</p>

          <div className="flex items-center gap-3 border border-gray-100 rounded-xl bg-gray-50 px-4 py-3">
            <Image src={usdtSymbol} width={24} height={24} alt="USDT" />
            <input
              value={amount}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="flex-1 bg-transparent text-lg font-medium outline-none placeholder-gray-300"
            />
            <button
              type="button"
              onClick={() => setAmount(currentDeposit.toFixed(6))}
              className="text-xs font-semibold text-[#238D9D] bg-[#E6FAFA] rounded-full px-3 py-1"
            >
              Max
            </button>
          </div>

          {/* Available */}
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-400">
              Vault balance:{" "}
              <span className="font-medium text-gray-600">{currentDeposit.toFixed(2)} USDT</span>
            </span>
            {numericAmount > currentDeposit && numericAmount > 0 && (
              <span className="text-xs text-red-500">Exceeds balance</span>
            )}
          </div>

          {/* Impact preview */}
          {withinDeposit && milesLost > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 leading-snug">
                {isFullWithdraw ? (
                  <span>You'll stop earning <strong>{milesLost.toLocaleString()} Miles/day</strong> after this withdrawal.</span>
                ) : (
                  <span>
                    Withdrawing removes <strong>{milesLost.toLocaleString()} Miles/day</strong> from your earnings.
                    {remainingMiles > 0 && (
                      <> You'll still earn <strong>{remainingMiles.toLocaleString()} Miles/day</strong>.</>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Remaining balance preview */}
          {withinDeposit && !isFullWithdraw && (
            <div className="flex items-center gap-2 mt-3 bg-[#F0FAF9] rounded-xl px-3 py-2">
              <Image src={akibaMilesSymbol} width={14} height={14} alt="Miles" />
              <span className="text-xs text-gray-600">
                Remaining:{" "}
                <span className="font-semibold text-[#238D9D]">
                  {(currentDeposit - numericAmount).toFixed(2)} USDT
                </span>
                {" "}&rarr;{" "}
                <span className="font-semibold text-[#238D9D]">{remainingMiles.toLocaleString()} Miles/day</span>
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 text-center px-2">{error}</p>
        )}

        {/* Loading state copy */}
        {loadingWithdraw && (
          <p className="text-center text-xs text-gray-500">
            Redeeming from Aave — this may take a moment…
          </p>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={!withinDeposit || loadingWithdraw}
          className="w-full rounded-2xl py-4 bg-[#238D9D] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
        >
          {loadingWithdraw ? (
            "Processing withdrawal…"
          ) : (
            <>
              Withdraw {numericAmount > 0 ? `${numericAmount.toFixed(2)} USDT` : ""}
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Success sheet */}
      {successOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={() => setSuccessOpen(false)}>
          <div
            className="w-full rounded-t-3xl bg-white p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-2">
              <div className="h-14 w-14 rounded-full bg-[#E6FAFA] flex items-center justify-center mb-1">
                <CheckCircle2 className="h-8 w-8 text-[#238D9D]" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Withdrawal successful!</h3>
              <p className="text-sm text-gray-500">
                {numericAmount.toFixed(2)} USDT has been sent to your wallet.
              </p>
            </div>

            <div className="rounded-2xl bg-[#F0FAF9] border border-[#C8EEED] px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Remaining vault balance</p>
              <div className="flex items-center gap-2">
                <Image src={usdtSymbol} width={16} height={16} alt="USDT" />
                <span className="text-base font-semibold text-gray-800">
                  {currentDeposit.toFixed(2)} USDT
                </span>
              </div>
            </div>

            {txHash && (
              <a
                href={`https://celoscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-xs text-[#238D9D] underline"
              >
                View on CeloScan
              </a>
            )}

            <button
              type="button"
              onClick={() => { setSuccessOpen(false); router.push("/earn"); }}
              className="w-full rounded-2xl py-4 bg-[#238D9D] text-white font-semibold text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
};

export default WithdrawPage;
