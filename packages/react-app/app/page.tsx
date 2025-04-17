"use client";

import { BottomNav } from "@/components/bottom-nav";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { GameCard } from "@/components/game-card";
import { Hero } from "@/components/Hero";
import JoinRafflesCarousel from "@/components/join-raffle-carousel";
import PointsCard from "@/components/points-card";
import { RaffleCard } from "@/components/raffle-card";
import RafflesWonCard from "@/components/raffle-won-card";
import { SectionHeading } from "@/components/section-heading";
/* eslint-disable react-hooks/exhaustive-deps */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWeb3 } from "@/contexts/useWeb3";
import { img } from "@/lib/img";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Home() {
    const {
        address,
        getUserAddress,
        sendCUSD,
        signTransaction,
        getMiniMilesBalance,
    } = useWeb3();

    const [miniMilesBalance, setMiniMilesBalance] = useState("0");
    const [cUSDLoading, setCUSDLoading] = useState(false);
    const [nftLoading, setNFTLoading] = useState(false);
    const [signingLoading, setSigningLoading] = useState(false);
    const [userOwnedNFTs, setUserOwnedNFTs] = useState<string[]>([]);
    const [tx, setTx] = useState<any>(undefined);
    const router = useRouter();
    const [amountToSend, setAmountToSend] = useState<string>("0.1");
    const [messageSigned, setMessageSigned] = useState<boolean>(false); // State to track if a message was signed


    useEffect(() => {
        getUserAddress();
    }, []);

      // Fetch user's MiniMiles token balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getMiniMilesBalance(address);
        setMiniMilesBalance(balance);
      } catch (error) {
        console.log(error);
      }
    };
    fetchBalance();
  }, [address, getMiniMilesBalance]);

    // useEffect(() => {
    //     const getData = async () => {
    //         const tokenURIs = await getNFTs();
    //         setUserOwnedNFTs(tokenURIs);
    //     };
    //     if (address) {
    //         getData();
    //     }
    // }, [address]);

    async function sendingCUSD() {
        if (address) {
            setSigningLoading(true);
            try {
                const tx = await sendCUSD(address, amountToSend);
                setTx(tx);
            } catch (error) {
                console.log(error);
            } finally {
                setSigningLoading(false);
            }
        }
    }

    async function signMessage() {
        setCUSDLoading(true);
        try {
            await signTransaction();
            setMessageSigned(true);
        } catch (error) {
            console.log(error);
        } finally {
            setCUSDLoading(false);
        }
    }


    // async function mintNFT() {
    //     setNFTLoading(true);
    //     try {
    //         const tx = await mintMinipayNFT();
    //         const tokenURIs = await getNFTs();
    //         setUserOwnedNFTs(tokenURIs);
    //         setTx(tx);
    //     } catch (error) {
    //         console.log(error);
    //     } finally {
    //         setNFTLoading(false);
    //     }
    // }


    // useEffect(() => {
    //     const hasOnboarded = localStorage.getItem("onboarding-complete");

    //     if (!hasOnboarded) {
    //     router.replace("/onboarding");
    //     } else {
    //     router.replace("/"); // Or wherever your actual home is
    //     }
    // }, []);

    return (
        <main className="pb-24 font-poppins">
            {/* <Hero /> */}
            <DashboardHeader name="Ibraa" />
            <PointsCard points={Number(miniMilesBalance)} />
            <RafflesWonCard />
            <DailyChallenges />
            <JoinRafflesCarousel />

            <SectionHeading title="Join digital cash raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4 whitespace-nowrap scrollbar-hide">
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
            
            </div>

            <SectionHeading title="Join physical goods raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <RaffleCard
                    image={img.win}
                    title="Ledger hardware wallet"
                    endsIn="5 days"
                    ticketCost="3 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="Laptop"
                    endsIn="4 days"
                    ticketCost="50 tickets by brand"
                />
            </div>

            <SectionHeading title="Join NFT Raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <RaffleCard
                    image={img.win}
                    title="BoredApe #567"
                    endsIn="3 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="CryptoPunk #789"
                    endsIn="2 days"
                    ticketCost="12 MiniMiles"
                />
            </div>

            <SectionHeading title="Upcoming games" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <GameCard
                    name="Dice"
                    date="xx/xx/xx"
                    image="/dice.jpg"
                />
                <GameCard
                    name="Coin flip"
                    date="xx/xx/xx"
                    image="/coin.jpg"
                />
            </div>
        </main>
    );
}
