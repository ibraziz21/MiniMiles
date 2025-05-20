import React from 'react'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Celo, MinimilesSymbol, MinimilesSymbolAlt, Ticket } from '@/lib/svg';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Slider } from './ui/slider';
import { Minus, Plus } from '@phosphor-icons/react';
import { RaffleImg1 } from '@/lib/img';

interface Raffle {
  title: string;
  reward: string;
  prize: string;
  endDate: string;
  ticketCost: string;
  image: any;
}

interface SpendPartnerQuestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raffle: Raffle | null;
}

const SpendPartnerQuestSheet = ({ open, onOpenChange, raffle }: SpendPartnerQuestSheetProps) => {
  if (!raffle) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-white rounded-t-xl font-poppins h-full">
        <div className="bg-white">
          <div className="flex items-center">
            <div className="bg-[#24E5E033] rounded-full flex justify-center ml-2">
              <h3 className="text-[#1E8C89] text-sm font-bold px-2">Raffle</h3>
            </div>
          </div>
          <h4 className="text-2xl font-bold">{raffle.title}</h4>

          <div className="bg-partner-quest bg-[#219653] bg-no-repeat bg-cover text-white text-center rounded-xl py-2">
            <div className="flex items-center justify-center my-3">
              <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
              <p className="text-3xl font-bold pl-2">{raffle.reward}</p>
            </div>
            <h4>MiniMiles</h4>
          </div>

          <div>
            <h3 className="text-gray-500 text-sm font-medium mb-4">Join our raffle and win big!</h3>
            <p>Raffle Details</p>
            <ol className="space-y-2 text-gray-800 text-sm my-2">
              <li className="flex justify-between">
                <h4 className="font-bold">Prize</h4>
                <p className="text-[#8E8B8B]">{raffle.prize}</p>
              </li>
              <li className="flex justify-between">
                <h4 className="font-bold">Ends</h4>
                <p className="text-[#8E8B8B]">{raffle.endDate}</p>
              </li>
              <li className="flex justify-between">
                <h4 className="font-bold">Ticket Price</h4>
                <p className="text-[#8E8B8B]">{raffle.ticketCost}</p>
              </li>
            </ol>
          </div>

          <h3>Buy Tickets</h3>
          <div className="flex items-center justify-center gap-2">
            <Image src={Ticket} alt="" />
            <h4 className="font-bold text-[#07955F]">1 Ticket</h4>
          </div>

          <Button title="Buy" onClick={() => { }} className="w-full mt-4 rounded-xl py-6 text-white bg-[#07955F]" />
          <p className="text-center text-[10px] text-gray-400 mt-2">{raffle.endDate}</p>
          <div className='flex justify-between'>
            <button className='bg-[#07955F1A] rounded-full p-2'>
              <Minus color='#07955F' width={24} height={24} />
            </button>
            <Slider defaultValue={[33]} max={100} step={1} />
            <button className='bg-[#07955F1A] rounded-full p-2'>
              <Plus color='#07955F' width={24} height={24} />
            </button>
          </div>
          <div className='flex justify-between '>
            <button
              className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"

            >
              <Image src={Ticket} alt="" />
              <h3>5</h3>
            </button>
            <button
              className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"

            >
              <Image src={Ticket} alt="" />
              <h3>10</h3>
            </button>
            <button
              className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"

            >
              <Image src={Ticket} alt="" />
              <h3>25</h3>
            </button>
            <button
              className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"

            >
              <Image src={Ticket} alt="" />
              <h3>50</h3>
            </button>
          </div>
          <h4>
            Select an amount of tickets to buy
          </h4>
          <h4 className='flex justify-center items-center'>Balance: <Image src={MinimilesSymbol} alt='' /> 45 <button className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"> Max</button> </h4>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SpendPartnerQuestSheet