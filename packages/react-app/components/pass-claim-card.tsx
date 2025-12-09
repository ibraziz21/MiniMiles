// components/PassClaimCard.tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { akibaMilesSymbol, SeasonOneTxn, SeasonOneTxnDisabled } from "@/lib/svg";

// SVG Progress Bar Component
function DottedProgressBar({ value }: { value: number }) {
  const segments = 4;
  const filledSegments = Math.ceil(value / (100 / segments));

  return (
    <svg width="152" height="8" viewBox="0 0 152 8" fill="none" xmlns="http://www.w3.org/2000/svg">
      {Array.from({ length: segments }).map((_, i) => {
        const isFilled = i < filledSegments;
        const x = i * 40;

        const fillColor = value === 0 ? "#E5E7EB" : "#238D9D";
        const fillOpacity = value === 0 ? 0.5 : (isFilled ? 1 : 0.3);

        return (
          <rect
            key={i}
            x={x}
            width="32"
            height="8"
            rx="4"
            fill={fillColor}
            fillOpacity={fillOpacity}
          />
        );
      })}
    </svg>
  );
}

// Tier data structure
interface Tier {
  name: string;
  required: number;
  users_completed: string;
  completion_rate: number;
}

interface Badge {
  id: string;
  title: string;
  description: string;
  reward_points: number;
  progress: number;
  isClaimed: boolean;
  current_transactions: number;
  current_tier: string | null;
  tiers: Tier[];
}

// Badge Data with tier information
const DUMMY_BADGES: Badge[] = [
  {
    id: "1",
    title: "S1 Transactions",
    description: "Number of transactions on Celo in Season 1",
    reward_points: 150,
    progress: 0,
    isClaimed: false,
    current_transactions: 0,
    current_tier: null,
    tiers: [
      { name: "Tier 1", required: 10, users_completed: "10.8K", completion_rate: 84 },
      { name: "Tier 2", required: 50, users_completed: "4.3K", completion_rate: 57 },
      { name: "Tier 3", required: 100, users_completed: "1.2K", completion_rate: 26 },
      { name: "Tier 4", required: 250, users_completed: "210", completion_rate: 1 },
      { name: "Tier MAX", required: 500, users_completed: "15", completion_rate: 0.01 },
    ],
  },
  {
    id: "2",
    title: "S1 Transactions",
    description: "Number of transactions on Celo in Season 1",
    reward_points: 150,
    progress: 60,
    isClaimed: false,
    current_transactions: 123,
    current_tier: "Tier 3",
    tiers: [
      { name: "Tier 1", required: 10, users_completed: "10.8K", completion_rate: 84 },
      { name: "Tier 2", required: 50, users_completed: "4.3K", completion_rate: 57 },
      { name: "Tier 3", required: 100, users_completed: "1.2K", completion_rate: 26 },
      { name: "Tier 4", required: 250, users_completed: "210", completion_rate: 1 },
      { name: "Tier MAX", required: 500, users_completed: "15", completion_rate: 0.01 },
    ],
  },
  {
    id: "3",
    title: "S1 Transactions",
    description: "Number of transactions on Celo in Season 1",
    reward_points: 150,
    progress: 100,
    isClaimed: true,
    current_transactions: 506,
    current_tier: "Tier MAX",
    tiers: [
      { name: "Tier 1", required: 10, users_completed: "10.8K", completion_rate: 84 },
      { name: "Tier 2", required: 50, users_completed: "4.3K", completion_rate: 57 },
      { name: "Tier 3", required: 100, users_completed: "1.2K", completion_rate: 26 },
      { name: "Tier 4", required: 250, users_completed: "210", completion_rate: 1 },
      { name: "Tier MAX", required: 500, users_completed: "15", completion_rate: 0.01 },
    ],
  },
];

export default function PassClaimCard({ viewMode = 'all' }: { viewMode?: 'all' | 'active' | 'completed' }) {
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);

  const badges = DUMMY_BADGES.filter(badge => {
    if (viewMode === 'all') return true;
    return viewMode === 'active' ? !badge.isClaimed : badge.isClaimed;
  });

  const handleClaim = () => {
    if (!selectedBadge) return;
    console.log("Claiming badge:", selectedBadge.id);
    setSelectedBadge(null);
  };

  if (badges.length === 0) {
    return <p className="text-sm text-gray-500 my-4">No badges to display.</p>;
  }

  return (
    <>
      <div className="flex space-x-3 overflow-x-auto mt-4 pb-2">
        {badges.map((badge) => {
          const isUninitiated = badge.progress === 0;
          const iconSrc = isUninitiated ? SeasonOneTxnDisabled : SeasonOneTxn;

          return (
            <Card
              key={badge.id}
              className={`flex-none w-44 h-60 flex flex-col justify-between p-4 shadow-xl transition-all duration-300 cursor-pointer ${
                badge.isClaimed ? "bg-blue-50 opacity-70" : "bg-white border border-[#238D9D4D] hover:shadow-2xl"
              } ${isUninitiated ? "opacity-70" : ""}`}
              onClick={() => !isUninitiated && setSelectedBadge(badge)}
            >
              <CardContent className="flex flex-col items-center p-0 h-full justify-between">
                <Image src={iconSrc} alt={badge.title} width={48} height={48} className="mt-2" />

                <div className="text-center flex-grow flex flex-col justify-center">
                  <h3 className="text-sm font-medium mt-2">{badge.title}</h3>
                  <p className="text-xs text-gray-600 mt-1 px-1 break-words leading-4 font-poppins">
                    {badge.description}
                  </p>
                </div>

                {!badge.isClaimed && badge.progress <= 100 && (
                  <div className="w-full mt-3">
                    <DottedProgressBar value={badge.progress} />
                  </div>
                )}
              </CardContent>

              <CardFooter className="p-0 mt-2">
                {badge.isClaimed && (
                  <div className="w-full bg-green-500 text-white text-center py-2 rounded-md font-medium text-sm">
                    Completed
                  </div>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Sheet open={!!selectedBadge} onOpenChange={() => setSelectedBadge(null)}>
        <SheetContent className="overflow-y-auto bg-white">
          {selectedBadge && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedBadge.title}</SheetTitle>
                <SheetDescription>{selectedBadge.description}</SheetDescription>
              </SheetHeader>

              <div className="py-6 space-y-5">
                {/* Large Icon */}
                <div className="flex items-center justify-center mb-4">
                  <Image src={SeasonOneTxn} alt={selectedBadge.title} width={80} height={80} />
                </div>

                {/* Current Progress */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-base font-bold text-gray-800 mb-3">
                    Your Progress: {selectedBadge.current_transactions} Transactions
                  </p>
                  <div className="flex justify-center mb-2">
                    <DottedProgressBar value={selectedBadge.progress} />
                  </div>
                  <p className="text-sm text-gray-500 text-center">
                    {Math.round(selectedBadge.progress)}% Complete
                  </p>
                </div>

                {/* Tiers */}
                <div className="space-y-3">
                  <p className="text-sm font-bold text-gray-700">Tiers</p>
                  {selectedBadge.tiers.map((tier, index) => {
                    const isCompleted = selectedBadge.current_transactions >= tier.required;
                    const isCurrent = !isCompleted && (
                      index === 0 || selectedBadge.current_transactions >= selectedBadge.tiers[index - 1].required
                    );

                    return (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                          isCurrent
                            ? 'bg-blue-50 border-blue-300 shadow-sm'
                            : isCompleted
                            ? 'bg-green-50 border-green-300'
                            : 'bg-gray-50 border-gray-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="mt-0.5">
                            {isCompleted ? (
                              <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                                <span className="text-white text-xs">✓</span>
                              </div>
                            ) : (
                              <div className={`w-5 h-5 rounded-full border-2 ${
                                isCurrent ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                              }`} />
                            )}
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${
                              isCurrent ? 'text-blue-700' : isCompleted ? 'text-green-700' : 'text-gray-600'
                            }`}>
                              {tier.name}: {tier.required} transactions on Celo in Season 1
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {tier.users_completed} ({tier.completion_rate}%) Users Completed
                            </p>
                          </div>
                        </div>

                        {isCurrent && (
                          <span className="text-xs font-medium bg-blue-500 text-white px-2 py-1 rounded">
                            Current
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Reward */}
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-800">
                      <Image src={akibaMilesSymbol} alt="" className="inline mr-2" width={24} height={24} />
                      {selectedBadge.reward_points} AkibaMiles
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Reward upon completion</p>
                  </div>
                </div>
              </div>

              <SheetFooter className="mt-auto">
                {selectedBadge.progress === 100 && !selectedBadge.isClaimed && (
                  <Button title="Claim Badge" className="w-full bg-green-500 hover:bg-green-600 text-white text-lg py-6" onClick={handleClaim}>
                    Claim Badge
                  </Button>
                )}

                {selectedBadge.isClaimed && (
                  <div className="w-full bg-green-500 text-white text-center py-4 rounded-lg font-bold text-lg">
                    ✓ Already Claimed
                  </div>
                )}

                {selectedBadge.progress < 100 && (
                  <div className="w-full bg-gray-100 text-gray-600 text-center py-4 rounded-lg font-medium">
                    Keep going to complete this badge!
                  </div>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}