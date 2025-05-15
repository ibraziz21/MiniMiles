import React from 'react'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Celo, MinimilesSymbolAlt } from '@/lib/svg';
import Image from 'next/image';

interface PartnerQuestSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    quest: {
        img: any;
        title: string;
        description: string;
        reward: string;
        color: string;
    } | null;
}

const EarnPartnerQuestSheet = ({ open, onOpenChange, quest }: PartnerQuestSheetProps) => {
    if (!quest) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="bg-white rounded-t-xl font-poppins">
                <div className="bg-white">
                    <div className='flex items-center'>
                        <div className="bg-[#24E5E033] rounded-full flex justify-center ml-2">
                            <h3 className='text-[#1E8C89] text-sm font-bold px-2'>Daily Challenge</h3>
                        </div>
                    </div>
                    <h4 className='text-2xl font-bold'>{quest.title}</h4>

                    <div className="bg-partner-quest bg-[#219653] bg-no-repeat bg-cover text-white text-center rounded-xl py-2">
                        <div className="flex items-center justify-center my-3">
                            <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
                            <p className="text-3xl font-bold pl-2">{quest.reward.split(" ")[0]}</p>
                        </div>
                        <h4>MiniMiles</h4>
                    </div>

                    <div className="">
                        <h3 className="text-gray-500 text-sm font-medium mb-4">{quest.description}</h3>
                        <p>Instructions</p>
                        <ol className="list-decimal list-inside space-y-2 text-gray-800 text-sm my-2">
                            <li className='flex'>
                                <h3 className='p-3 font-bold text-[#8E8B8B]'>1</h3>
                                <div className='flex flex-col'>
                                    <h4 className='font-bold'>Connect</h4>
                                    <p className='text-[#8E8B8B]'>Visit the partner platform</p>
                                </div>
                            </li>
                            <li className='flex'>
                                <h3 className='p-3 font-bold text-[#8E8B8B]'>2</h3>
                                <div className='flex flex-col'>
                                    <h4 className='font-bold'>Complete the quest</h4>
                                    <p className='text-[#8E8B8B]'>Follow the instructions to claim</p>
                                </div>
                            </li>
                        </ol>
                    </div>

                    <Button title="Pay & Earn" onClick={() => { }} className="w-full rounded-xl py-6 text-white bg-[#07955F]" />
                    <Button title="Close" onClick={() => onOpenChange(false)} className="w-full rounded-xl py-6 text-[#07955F] bg-[#07955F1A]" />
                    <p className="text-center text-[10px] text-gray-400 mt-2">
                        Valid until xx/xx/xx. These terms apply.
                    </p>
                </div>
            </SheetContent>
        </Sheet>
    );
};

export default EarnPartnerQuestSheet;
