"use client";

import MiniMilesHeader from "@/components/mini-miles-header";
import QuestCard from "@/components/quest-card";
import QuestDetailModal from "@/components/quest-details-modal";
import { useState } from "react";


export default function EarnPage() {
    const [filter, setFilter] = useState("active");
    const [modalOpen, setModalOpen] = useState(false);

    const partners = [
        { name: "Celo", icon: "/partners/celo.svg" },
        { name: "MiniPay", icon: "/partners/minipay.svg" },
        { name: "GLO dollar", icon: "/partners/glo.svg" },
        { name: "Mento", icon: "/partners/mento.svg" },
    ];

    return (
        <div className="pb-24">
            <MiniMilesHeader total={1200} filter={filter} setFilter={setFilter} />

            <div className="mt-4 px-4">
                <h3 className="font-semibold mb-2">Earn points</h3>
                <div className="flex gap-3 overflow-x-auto">
                    <div onClick={() => setModalOpen(true)}>
                        <QuestCard
                            title="Spend 5 USDT"
                            description="Spend 5 USDT from your MiniPay wallet daily."
                            reward="2 MiniMiles"
                        />
                    </div>
                    <div onClick={() => setModalOpen(true)}>
                        <QuestCard
                            title="Refer a friend"
                            description="Get them to use MiniMiles and earn."
                            reward="10 MiniMiles"
                        />

                    </div>
                </div>
            </div>

            <div className="mt-6 px-4">
                <h3 className="font-semibold mb-2">Partner quests</h3>
                <div className="grid grid-cols-2 gap-4">
                    {partners.map((p, i) => (
                        <div onClick={() => setModalOpen(true)} key={i} className="flex flex-col items-center bg-white p-4 rounded-xl shadow-sm">
                            <img src={p.icon} alt={p.name} className="h-10 w-10 mb-2" />
                            <p className="text-sm font-medium">{p.name}</p>
                        </div>
                    ))}
                </div>
            </div>

            <QuestDetailModal open={modalOpen} onOpenChange={setModalOpen} />
        </div>
    );
}
