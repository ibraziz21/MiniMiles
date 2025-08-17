"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { XCircleIcon } from "lucide-react";
import { USDT } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { Button } from "@/components/ui/button";

const WithdrawPage = () => {
  const router = useRouter();

  // ✅ Call once
  const web3 = useWeb3() as any;
  const { address, getUserAddress } = web3;

  const [currentDeposit, setCurrentDeposit] = useState<number>(0);
  const [amount, setAmount] = useState<string>("");
  const [loadingWithdraw, setLoadingWithdraw] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const numericAmount = useMemo(
    () => (amount ? Math.max(0, Number(amount)) : 0),
    [amount]
  );
  const withinDeposit = numericAmount > 0 && numericAmount <= currentDeposit;

  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);

  useEffect(() => {
    if (!address) return;
    (async () => {
      const dep = await web3?.getVaultDeposit?.().catch(() => null);
      if (dep != null) setCurrentDeposit(Number(dep));
    })();
  }, [address, web3]);

  const setMax = () => setAmount(String(currentDeposit || 0));

  const onChangeAmount = (v: string) => {
    const clean = v.replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    const safe =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
    setAmount(safe);
  };

  const handleWithdraw = async () => {
    if (!withinDeposit) return;
    setLoadingWithdraw(true);
    try {
      const res = await web3?.withdrawFromVault?.(String(numericAmount));
      if (res?.txHash) setTxHash(res.txHash);

      setCurrentDeposit((d) => Math.max(0, d - numericAmount));
      setSuccessOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingWithdraw(false);
    }
  };

  const closeSuccess = () => {
    setSuccessOpen(false);
    router.push("/earn");
  };

  return (
    <main className="px-4 flex flex-col justify-around h-[calc(100vh-100px)]">
      <div>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Withdraw from Vault</h3>
          <button onClick={() => router.back()} aria-label="Close">
            <XCircleIcon />
          </button>
        </div>
        <p>Withdraw any amount from your vault.</p>
      </div>

      <div className="flex flex-col justify-center  p-5 border border-[#238D9D4D] bg-white rounded-xl">
        <h4>My Deposit(USDT)</h4>
        <div className="flex border border-[#238D9D4D] rounded-xl p-4">
          <Image src={USDT} alt="" />
          <h3 className="mx-2">{currentDeposit.toFixed(2)}</h3>
        </div>
      </div>

      <div className="border border-[#238D9D4D] bg-gradient-to-bl from-[#76E0F0] to-[#F0FDFF] rounded-xl p-4">
        <h4 className='my-2'>New Withdrawal(USDT)</h4>
        <div className="flex flex-col justify-center items-start p-5 border border-[#238D9D4D] bg-white rounded-xl">
          <div className="flex items-center w-full">
            <Image src={USDT} alt="" />
            <input
              value={amount}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="mx-2 w-full outline-none"
            />
          </div>
          <div className='flex justify-between w-full'>
            <h4>Available:</h4>
            <div className="flex ">
              <h4>{currentDeposit.toFixed(2)}</h4>
              <button
                onClick={setMax}
                className="rounded-full px-2 text-[#238D9D] font-semibold bg-[#F0FDFF]"
              >
                Max
              </button>
            </div>
          </div>
        </div>
      </div>

      {loadingWithdraw ? (
        <p className="text-center text-sm text-gray-600">
          Almost there, just tying up a few digital knots…
        </p>
      ) : (
        <div className="h-5" />
      )}

      <Button
        title={loadingWithdraw ? "Processing withdrawal..." : "Withdraw"}
        onClick={handleWithdraw}
        widthFull
        loading={loadingWithdraw}
        disabled={!withinDeposit}
        className="w-full rounded-2xl mt-0 py-4 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-white bg-[#238D9D] hover:bg-[#238D9D] disabled:bg-[#238D9D]"
      />

      {successOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40">
          <div className="w-full rounded-t-2xl bg-white p-5">
            <h3 className="text-lg font-semibold">Withdrawal Successful!</h3>
            <p className="mt-1">
              {numericAmount.toFixed(2)} USDT has been sent to your wallet.
            </p>
            <div className="mt-4 border border-[#238D9D4D] bg-[#F0FDFF] rounded-xl p-4">
              <p className="text-sm">Updated Vault Balance (USDT)</p>
              <div className="flex items-center mt-2">
                <Image src={USDT} alt="" />
                <h3 className="mx-2">{(currentDeposit).toFixed(2)}</h3>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <a
                className="text-[#238D9D] underline"
                href={txHash ? `https://etherscan.io/tx/${txHash}` : "#"}
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

export default WithdrawPage;
