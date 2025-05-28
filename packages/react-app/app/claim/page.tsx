"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import ClaimUsernamePage from "@/components/claim-username";

export default function ClaimPage() {
    const router = useRouter();
    const [claimUsername, setClaimUsername] = useState(false);

    return (
        <div className="bg-white">
            {
                claimUsername ? <ClaimUsernamePage /> : <main className="relative flex h-dvh flex-col items-center justify-between bg-claim bg-cover bg-center px-6 py-10 font-sterling bg-[#F5FFFB] bg-opacity-80">
                    {/* Headline */}
                    <div className="mt-24 flex flex-col items-center text-center">
                        <h1 className="text-4xl  leading-tight text-primarygreen">
                            Welcome to <br />
                            <span className="text-5xl font-medium">MiniMiles</span>
                        </h1>
                        <p className="mt-4 max-w-xs text-base text-muted-foreground">
                            A gamified loyalty layer for the Minipay ecosystem.
                        </p>
                    </div>

                    {/* CTA */}
                    <div>
                        <Button
                            title="Let's go"
                            widthFull
                            className="rounded-xl py-6 text-lg font-medium shadow-sm bg-[#07955F] "
                            onClick={() => setClaimUsername(true)}
                        />

                        <p className="mt-3 text-center text-xs text-muted-foreground text-[#07955F] font-medium">
                            By proceeding you agree with the <span className="underline">Terms & Conditions</span>
                        </p>
                    </div>
                </main>
            }
        </div>
    );
}