"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { XCircleIcon } from "lucide-react";
import { USDT } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { Button } from "@/components/ui/button";

const VaultPage = () => {
  const router = useRouter();

  // ✅ Call the hook once, at top-level
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getakibaMilesBalance, getUSDTBalance,getUserVaultBalance, approveVault, deposit, hasAllowance } = web3;

  // balances
  const [available, setAvailable] = useState<number>(0);
  const [currentDeposit, setCurrentDeposit] = useState<number>(0);
  // input + state
  const [amount, setAmount] = useState<string>("");
  const [approved, setApproved] = useState(false);
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [loadingDeposit, setLoadingDeposit] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const numericAmount = useMemo(
    () => (amount ? Math.max(0, Number(amount)) : 0),
    [amount]
  );
  const minOK = numericAmount >= 1;
  const withinBal = numericAmount <= available;

  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only check when user has typed a valid minimum amount
      if (!address || !minOK) {
        if (!cancelled) setApproved(false);
        return;
      }
      try {
        const ok = await hasAllowance(String(numericAmount));
        if (!cancelled) setApproved(ok);
      } catch {
        if (!cancelled) setApproved(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, minOK, numericAmount, hasAllowance]);


  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getUSDTBalance();
        setAvailable(balance); // ← number
      } catch (e) { console.log(e); }
    };
    fetchBalance();
  }, [address, getUSDTBalance]);
  
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getUserVaultBalance();
        setCurrentDeposit(balance); // ← number
      } catch (e) { console.log(e); }
    };
    fetchBalance();
  }, [address, getUserVaultBalance]);

  const setMax = () => setAmount(String(available || 0));

  const onChangeAmount = (v: string) => {
    const clean = v.replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    const safe =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
    setAmount(safe);
  };

  const handleApprove = async () => {
    if (!minOK || !withinBal || approved) return;
    setLoadingApprove(true);
    try {
      const { hash, receipt } = await approveVault(String(numericAmount));
      setTxHash(hash);               // ← use returned hash
      setApproved(true);             // (or re-check via hasAllowance)
    } catch (e) {
      console.error(e);
      setApproved(false);
    } finally {
      setLoadingApprove(false);
    }
  };

  const handleDeposit = async () => {
    if (!approved || !minOK || !withinBal) return;
    setLoadingDeposit(true);
    try {
      const { hash } = await deposit(String(numericAmount)); // ← correct fn name
      setTxHash(hash);
  
      // optimistic update
      setAvailable((b) => Math.max(0, b - numericAmount));
      setCurrentDeposit((d) => d + numericAmount);
  
      setSuccessOpen(true);
      await getakibaMilesBalance?.().catch(() => {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDeposit(false);
    }
  };

  const closeSuccess = () => {
    setSuccessOpen(false);
    router.push("/earn");
  };

  return (
    <main className="px-4 flex flex-col justify-around h-[calc(100vh-100px)] font-sterling">
      <div>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Deposit into Vault</h3>
          <button onClick={() => router.back()} aria-label="Close">
            <XCircleIcon />
          </button>
        </div>
        <p className="font-light text-[#525252]">Earn 1 AkibaMile per day for every 1 USDT you deposit. Rewards are sent to your balance every 24 hours.</p>
      </div>

      <div className="flex flex-col justify-center  p-5 border border-[#238D9D4D] bg-white rounded-xl">
        <h4 className="my-3 text-[#817E7E]">My Deposit(USDT)</h4>
        <div className="flex border border-[#238D9D4D] rounded-xl p-4">
          <Image src={USDT} alt="" />
          <h3 className="mx-2">{currentDeposit}</h3>
        </div>
      </div>

      <div className="border border-[#238D9D4D] bg-gradient-to-bl from-[#76E0F020] to-[#F0FDFF] rounded-xl p-4">
        <h4 className='my-2 text-[#817E7E]'>New Deposit(USDT)</h4>
        <div className="flex flex-col justify-center items-start p-5 border border-[#238D9D4D] bg-white rounded-xl">
          <div className="flex items-center justify-around w-full">
            <Image src={USDT} alt="" />
            <input
              value={amount}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="mx-2 w-full outline-none"
            />
          </div>
          <div className='flex justify-between w-full mt-6'>
            <h4>Available:</h4>
            <div className="flex ">
              <h4>{available}</h4>
              <button
                onClick={setMax}
                className="rounded-full px-2 text-[#238D9D] font-semibold bg-[#F0FDFF]"
              >
                Max
              </button>
            </div>
          </div>

          {!minOK && amount && (
            <p className="text-xs text-red-500 mt-2">Min. deposit is 1 USDT</p>
          )}
          {!withinBal && (
            <p className="text-xs text-red-500 mt-1">Insufficient balance</p>
          )}
        </div>
      </div>

      {!approved ? (
        <Button
          title={loadingApprove ? "Approving USDT..." : "Approve USDT"}
          onClick={handleApprove}
          widthFull
          loading={loadingApprove}
          disabled={!minOK || !withinBal}
          className="w-full rounded-xl mt-5 py-6 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-white bg-[#238D9D] hover:bg-[#238D9D] disabled:bg-[#238D9D]"
        />
      ) : (
        <Button
          title={loadingDeposit ? "Processing deposit..." : "Deposit"}
          onClick={handleDeposit}
          widthFull
          loading={loadingDeposit}
          disabled={!minOK || !withinBal}
          className="w-full rounded-xl mt-5 py-6 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-white bg-[#238D9D] hover:bg-[#238D9D] disabled:bg-[#238D9D]"
        />
      )}

      {successOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40">
          <div className="w-full rounded-t-2xl bg-white p-5">
            <h3 className="text-lg font-semibold">Deposit Successful!</h3>
            <p className="mt-1">
              You added {numericAmount} USDT to the Akiba Vault.
              Rewards will be included in the next daily payout.
            </p>
            <div className="mt-4 border border-[#238D9D4D] bg-[#F0FDFF] rounded-xl p-4">
              <p className="text-sm">Updated Vault Balance (USDT)</p>
              <div className="flex items-center mt-2">
                <Image src={USDT} alt="" />
                <h3 className="mx-2">{(currentDeposit + numericAmount)}</h3>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <a
                className="text-[#238D9D] underline"
                href={txHash ? `https://celoscan.io/tx/${txHash}` : "#"}
                target="_blank"
                rel="noreferrer"
              >
                View blockchain receipt
              </a>
              <Button
                title="Close"
                onClick={closeSuccess}
                className="rounded-2xl py-2 px-4 bg-[#238D9D] text-white hover:bg-[#238D9D]"
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default VaultPage;
