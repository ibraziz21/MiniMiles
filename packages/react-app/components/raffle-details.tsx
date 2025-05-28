"use client";

import Image, { StaticImageData } from "next/image";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Gift, Calendar, DollarSign } from "lucide-react";

export type ControlledRaffleSheetProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  image: string | StaticImageData;
  prize: string;
  pricePerTicket: string;
  drawDate: string;
  balance: number;
};

export const RaffleDetails = ({
  open,
  onOpenChange,
  title,
  image,
  prize,
  pricePerTicket,
  drawDate,
  balance,
}: ControlledRaffleSheetProps) => {
  const [selected, setSelected] = useState(10);
  const options = [5, 10, 50];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
      side="bottom"
      className="bg-white rounded-t-2xl shadow-lg" 
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Raffle details</SheetDescription>
        </SheetHeader>

        <section className="p-4">
          {/* hero image */}
          <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
            <Image src={image} alt={title} fill className="object-cover" />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <p className="text-white text-2xl font-medium">{prize}</p>
            </div>
          </div>

          <div className="space-y-3 mb-6 text-sm">
            <DetailRow icon={<Gift size={18} />} label="Prize" value={prize} />
            <DetailRow
              icon={<DollarSign size={18} />}
              label="Price / ticket"
              value={pricePerTicket}
            />
            <DetailRow
              icon={<Calendar size={18} />}
              label="Draw date"
              value={drawDate}
            />
          </div>

          {/* ticket selector */}
          <p className="text-center text-gray-600 mb-2 text-sm">
            Select ticket amount
          </p>
          <div className="flex gap-2 mb-2">
            {options.map((n) => (
              <button
                key={n}
                onClick={() => setSelected(n)}
                className={`flex-1 rounded-xl py-3 font-medium ${
                  selected === n ? "border-2 border-black bg-white" : "bg-gray-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-right text-xs text-gray-500">
            Balance: {balance} MiniMiles
          </p>

          <SheetFooter className="mt-6">
            <Button className="w-full bg-blue"     title={`Buy ${selected} tickets`} >Buy {selected} tickets</Button>
          </SheetFooter>
        </section>
      </SheetContent>
    </Sheet>
  );
};

const DetailRow = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="flex items-center gap-3">
    <div className="w-5 h-5 flex items-center justify-center">{icon}</div>
    <span>{label}:</span>
    <span className="font-medium">{value}</span>
  </div>
);
