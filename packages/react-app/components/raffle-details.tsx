'use client';

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Gift, Calendar, DollarSign } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

type RaffleDetailsProps = {
  title: string;
  image: string;
  prize: string;
  pricePerTicket: string;
  drawDate: string;
  balance: number;
};

export const RaffleDetails = ({
  title,
  image,
  prize,
  pricePerTicket,
  drawDate,
  balance
}: RaffleDetailsProps) => {
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const ticketOptions = [5, 10, 50];

  return (
    <Sheet>
    <SheetTrigger asChild>
      <Button title="View" onClick={()=>{}} variant="outline">Open</Button>
    </SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Edit profile</SheetTitle>
        <SheetDescription>
          Make changes to your profile here. Click save when you're done.
        </SheetDescription>
      </SheetHeader>
      <section className="p-4 max-w-md mx-auto">
      <h2 className="text-xl font-semibold text-center mb-4">{title}</h2>

      <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
        <Image
          src={image}
          alt={title}
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <p className="text-white text-2xl font-bold">{prize}</p>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <DetailRow icon={<Gift size={20} />} label="Prize" value={prize} />
        <DetailRow icon={<DollarSign size={20} />} label="Price per ticket" value={pricePerTicket} />
        <DetailRow icon={<Calendar size={20} />} label="Draw Date" value={drawDate} />
      </div>

      <div className="mb-4">
        <p className="text-center mb-2 text-gray-700 text-sm">Select an amount of tickets to buy</p>
        <div className="flex justify-between gap-2">
          {ticketOptions.map(amount => (
            <button
              key={amount}
              onClick={() => setSelectedAmount(amount)}
              className={`flex-1 rounded-xl py-3 font-semibold ${
                selectedAmount === amount
                  ? "border-2 border-black bg-white"
                  : "bg-gray-100"
              }`}
            >
              {amount}
            </button>
          ))}
        </div>
        <p className="text-right text-xs text-gray-500 mt-1">Balance: {balance} MiniMiles</p>
      </div>

    </section>
    </SheetContent>
  </Sheet>
    
  );
};

type DetailRowProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
};

const DetailRow = ({ icon, label, value }: DetailRowProps) => (
  <div className="flex items-center gap-3 text-sm font-medium text-gray-800">
    <div className="flex items-center justify-center w-6 h-6">{icon}</div>
    <span>{label}:</span>
    <span className="font-semibold">{value}</span>
  </div>
);
