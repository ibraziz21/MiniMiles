"use client";

import { useState, useCallback, useEffect } from "react";
import {
    CheckCircledIcon,
    CrossCircledIcon,
    InfoCircledIcon,
} from "@radix-ui/react-icons";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useWeb3 } from "@/contexts/useWeb3"; // ← already in your repo
import { cn } from "@/lib/utils";
import UsernameClaimSheet from "./username-claim-sheet";
import { useRouter } from "next/navigation";

type Status = "idle" | "checking" | "available" | "taken";

export default function ClaimUsernamePage() {
    const { address } = useWeb3();


    const [username, setUsername] = useState("");
    const [status, setStatus] = useState<Status>("idle");
    const [sheetOpen, setSheetOpen] = useState(false);
    const router = useRouter()


    const checkAvailability = useCallback(async (name: string) => {
        if (!name) return setStatus("idle");
        setStatus("checking");
        await new Promise((r) => setTimeout(r, 500)); // simulate latency
        setStatus(name.toLowerCase() === "winner" ? "available" : "taken");
    }, []);

    useEffect(() => {
        const id = setTimeout(() => checkAvailability(username), 350);
        return () => clearTimeout(id);
    }, [username, checkAvailability]);


    const isClaimable = status === "available";

    const StatusLine = () => {
        if (status === "available")
            return (
                <p className="flex items-center gap-1 text-sm font-medium text-primarygreen">
                    <CheckCircledIcon className="h-4 w-4" /> Available
                </p>
            );
        if (status === "taken")
            return (
                <p className="flex items-center gap-1 text-sm font-medium text-destructive">
                    <CrossCircledIcon className="h-4 w-4" /> Already claimed
                </p>
            );
        return null; // idle / checking
    };


    return (
        <>
            <main className="flex min-h-dvh flex-col gap-10 px-3 py-10 font-sterling">

                <header className="space-y-1">
                    <h1 className="text-xl font-medium">Claim your MiniMiles username</h1>
                    <p className="text-sm text-muted-foreground">
                        Start by claiming your first{" "}
                        <span className="font-medium text-primarygreen">.mini</span>{" "}
                        username.
                    </p>
                </header>

                <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-full min-w">
                        <input
                            placeholder="myname"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.trim())}
                            className={cn(
                                "w-full text-right shadow-none p-0 text-4xl font-medium placeholder:text-muted-foreground focus:outline-none",
                                status === "available" && "text-primarygreen",
                                status === "taken" && "text-destructive/80",
                                status === "idle" && "text-muted-foreground"
                            )}
                        />
                        <span
                            className={cn(
                                "text-4xl font-medium",
                                username ? "text-primarygreen" : "text-muted-foreground"
                            )}
                        >
                            .mini
                        </span>
                    </div>
                    <StatusLine />
                    {address && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            {address} <InfoCircledIcon className="h-3 w-3" />
                        </p>
                    )}
                </div>


                <UsernameClaimSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    username={username}
                    address={address}
                >
                    <Button
                        title="Claim username"
                        widthFull
                        className="rounded-xl py-6 text-lg font-medium shadow-sm bg-[#07955F] "
                        disabled={!isClaimable}
                        onClick={() => {setSheetOpen(true)
                            router.push("/")
                        }}
                    />
                </UsernameClaimSheet>
            </main>
        </>
    );
}
