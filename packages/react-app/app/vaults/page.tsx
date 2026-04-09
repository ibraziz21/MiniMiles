"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronRight } from "lucide-react";
import { usdtSymbol, akibaMilesSymbol } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { VaultBalanceCard } from "@/components/vault-balance-card";
import { useIsMiniPay } from "@/hooks/useIsMiniPay";

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {/* Step 1 */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step > 1
              ? "bg-[#238D9D] text-white"
              : step === 1
              ? "bg-[#238D9D] text-white"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          {step > 1 ? <CheckCircle2 className="h-4 w-4" /> : "1"}
        </span>
        <span
          className={`text-xs font-medium ${
            step === 1 ? "text-[#238D9D]" : "text-gray-400"
          }`}
        >
          Approve USDT
        </span>
      </div>

      <div className={`flex-1 h-px ${step > 1 ? "bg-[#238D9D]" : "bg-gray-200"}`} />

      {/* Step 2 */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step === 2 ? "bg-[#238D9D] text-white" : "bg-gray-200 text-gray-400"
          }`}
        >
          2
        </span>
        <span
          className={`text-xs font-medium ${
            step === 2 ? "text-[#238D9D]" : "text-gray-400"
          }`}
        >
          Deposit
        </span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const VaultPage = () => {
  const router = useRouter();
  const isMiniPay = useIsMiniPay();
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getUSDTBalance, approveVault, deposit, hasAllowance } = web3;

  const [available, setAvailable] = useState<number>(0);
  const [amount, setAmount] = useState<string>("");
  const [approved, setApproved] = useState(false);
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [loadingDeposit, setLoadingDeposit] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const numericAmount = useMemo(
    () => (amount ? Math.max(0, Number(amount)) : 0),
    [amount]
  );
  const minOK = numericAmount >= 1;
  const withinBal = numericAmount <= available;
  const canProceed = minOK && withinBal;

  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);

  useEffect(() => {
    if (isMiniPay === true) router.replace("/earn");
  }, [isMiniPay, router]);

  // Fetch USDT balance
  useEffect(() => {
    if (!address) return;
    getUSDTBalance?.()
      .then((b: string) => setAvailable(Number(b)))
      .catch(() => {});
  }, [address, getUSDTBalance]);

  // Check allowance whenever amount changes
  useEffect(() => {
    if (!address || !minOK) { setApproved(false); return; }
    let cancelled = false;
    hasAllowance?.(String(numericAmount))
      .then((ok: boolean) => { if (!cancelled) setApproved(ok); })
      .catch(() => { if (!cancelled) setApproved(false); });
    return () => { cancelled = true; };
  }, [address, minOK, numericAmount, hasAllowance]);

  if (isMiniPay !== false) return null;

  const onChangeAmount = (v: string) => {
    const clean = v.replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    const safe = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
    // Max 6 decimal places (USDT)
    const [int, dec] = safe.split(".");
    setAmount(dec !== undefined ? `${int}.${dec.slice(0, 6)}` : safe);
    setError(null);
  };

  const handleApprove = async () => {
    if (!canProceed || approved) return;
    setLoadingApprove(true);
    setError(null);
    try {
      await approveVault(String(numericAmount));
      setApproved(true);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "Approval failed");
    } finally {
      setLoadingApprove(false);
    }
  };

  const handleDeposit = async () => {
    if (!approved || !canProceed) return;
    setLoadingDeposit(true);
    setError(null);
    try {
      const { hash } = await deposit(String(numericAmount));
      setTxHash(hash);
      setAvailable((b) => Math.max(0, b - numericAmount));
      setRefreshKey((k) => k + 1);
      setSuccessOpen(true);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "Deposit failed. Please try again.");
    } finally {
      setLoadingDeposit(false);
    }
  };

  const closeSuccess = () => {
    setSuccessOpen(false);
    setAmount("");
    setApproved(false);
  };

  const projectedMiles = Math.floor(numericAmount);

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
          <h1 className="text-lg font-semibold text-gray-900">Akiba Vault</h1>
          <p className="text-xs text-gray-500">Deposit USDT, earn AkibaMiles daily</p>
        </div>
      </div>

      <div className="px-4 space-y-4 pb-8">
        {/* Balance card */}
        <VaultBalanceCard refreshKey={refreshKey} hideActions />

        {/* How it works note */}
        <div className="rounded-2xl border border-[#238D9D]/15 bg-[#E6FAFA]/40 px-4 py-3">
          <p className="text-xs text-[#238D9D] leading-relaxed">
            Your USDT is supplied to Aave on Celo. You receive <span className="font-semibold">1 AkibaMile per USDT per day</span> as a loyalty reward. Withdraw your full principal anytime.
          </p>
        </div>

        {/* Step indicator — only shown when approve is needed */}
        {canProceed && !approved && <StepIndicator step={1} />}
        {canProceed && approved && <StepIndicator step={2} />}

        {/* Deposit input card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-3">New deposit (USDT)</p>

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
              onClick={() => setAmount(String(Math.floor(available * 1e6) / 1e6))}
              className="text-xs font-semibold text-[#238D9D] bg-[#E6FAFA] rounded-full px-3 py-1"
            >
              Max
            </button>
          </div>

          {/* Available + validation */}
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-400">
              Available: <span className="font-medium text-gray-600">{available.toFixed(2)} USDT</span>
            </span>
            {amount && !minOK && (
              <span className="text-xs text-red-500">Min. 1 USDT</span>
            )}
            {!withinBal && numericAmount > 0 && (
              <span className="text-xs text-red-500">Insufficient balance</span>
            )}
          </div>

          {/* Miles projection */}
          {projectedMiles > 0 && (
            <div className="flex items-center gap-2 mt-3 bg-[#F0FAF9] rounded-xl px-3 py-2">
              <Image src={akibaMilesSymbol} width={14} height={14} alt="Miles" />
              <span className="text-xs text-gray-600">
                You'll earn{" "}
                <span className="font-semibold text-[#238D9D]">
                  +{projectedMiles.toLocaleString()} Miles/day
                </span>{" "}
                on this deposit
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 text-center px-2">{error}</p>
        )}

        {/* CTA */}
        {!approved ? (
          <button
            type="button"
            onClick={handleApprove}
            disabled={!canProceed || loadingApprove}
            className="w-full rounded-2xl py-4 bg-[#238D9D] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
          >
            {loadingApprove ? (
              "Approving…"
            ) : (
              <>
                Approve USDT
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDeposit}
            disabled={!canProceed || loadingDeposit}
            className="w-full rounded-2xl py-4 bg-[#238D9D] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
          >
            {loadingDeposit ? (
              "Depositing…"
            ) : (
              <>
                Deposit {numericAmount > 0 ? `${numericAmount.toFixed(2)} USDT` : ""}
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Success sheet */}
      {successOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={closeSuccess}>
          <div
            className="w-full rounded-t-3xl bg-white p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon */}
            <div className="flex flex-col items-center text-center gap-2">
              <div className="h-14 w-14 rounded-full bg-[#E6FAFA] flex items-center justify-center mb-1">
                <CheckCircle2 className="h-8 w-8 text-[#238D9D]" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Deposit successful!</h3>
              <p className="text-sm text-gray-500">
                Your USDT is now earning AkibaMiles.
              </p>
            </div>

            {/* Summary cards */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-2xl bg-[#F0FAF9] border border-[#C8EEED] px-4 py-3">
                <Image src={usdtSymbol} width={20} height={20} alt="USDT" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{numericAmount.toFixed(2)} USDT deposited</p>
                  <p className="text-xs text-gray-500">Principal secured in Aave vault</p>
                </div>
              </div>
              {projectedMiles > 0 && (
                <div className="flex items-center gap-3 rounded-2xl bg-[#F0FAF9] border border-[#C8EEED] px-4 py-3">
                  <Image src={akibaMilesSymbol} width={20} height={20} alt="Miles" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">+{projectedMiles.toLocaleString()} Miles/day</p>
                    <p className="text-xs text-gray-500">Credited to your balance every 24 hours</p>
                  </div>
                </div>
              )}
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
              onClick={closeSuccess}
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

export default VaultPage;
