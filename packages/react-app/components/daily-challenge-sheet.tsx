import React from 'react'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Celo, akibaMilesSymbolAlt } from '@/lib/svg';
import Image from 'next/image';
import { TokenRaffle } from '@/helpers/raffledisplay';

interface DailyChallengeSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    raffle: TokenRaffle | null;
}

const DailyChallengeSheet = ({ open, onOpenChange, raffle  }: DailyChallengeSheetProps) => {
    if (!raffle) return null;
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side={"bottom"} className="bg-white rounded-t-xl font-sterling">
                <div className="bg-white">
                    <div className='flex items-center'>
                        <div className="bg-[#FCFE53] w-[56px] rounded-full flex justify-center ">
                            <Image src={Celo} alt="" className='w-[24px]' />
                        </div>

                        <div className="bg-[#24E5E033] rounded-full flex justify-center ml-2">
                            <h3 className='text-[#1E8C89] text-sm font-medium px-2'>Partner quest</h3>
                        </div>
                    </div>
                    <h4 className='text-2xl font-medium'>{raffle.description}</h4>

                    <div className="bg-partner-quest bg-[#238D9D] bg-no-repeat bg-cover text-white text-center rounded-xl py-2">
                        <div className="flex items-center justify-center my-3">
                            <Image src={akibaMilesSymbolAlt} width={32} height={32} alt="" />
                            <p className="text-3xl font-medium pl-2">{raffle.ticketCost}</p>
                        </div>
                        <h4>akibaMiles</h4>
                    </div>

                    <div className="">
                        <h3 className="text-gray-500 text-sm font-medium mb-4">Swap $10 worth of tokens on Regenerative Finance DEX.</h3>
                        <p>Instructions</p>
                        <ol className="list-decimal list-inside space-y-2 text-gray-800 text-sm my-2">
                            <li className='flex'>
                                <h3 className='p-3 font-medium text-[#8E8B8B]'>1</h3>
                                <div className='flex flex-col'>
                                    <h4 className='font-medium'>
                                        Connect to ReFI DEX
                                    </h4>
                                    <p className='text-[#8E8B8B]'>Visit regenarative.fi</p>
                                </div>
                            </li>
                            <li className='flex'>
                                <h3 className='p-3 font-medium text-[#8E8B8B]'>2</h3>
                                <div className='flex flex-col'>
                                    <h4 className='font-medium'>
                                        Swap tokens on ReFi DEX
                                    </h4>
                                    <p className='text-[#8E8B8B]'>Swap $10 of eligible tokens (cKES, cUSD and CELO)</p>
                                </div>
                            </li>
                        </ol>
                    </div>
                    <Button title="Swap & earn 10x"
                        onClick={() => { }} className="w-full rounded-xl py-6 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-white bg-[#238D9D] hover:bg-[#238D9D]
                    disabled:bg-[#238D9D]">
                        
                    </Button>
                    <p className="text-center text-[10px] text-gray-400 mt-2">
                        Valid until xx/xx/xx. These terms apply.
                    </p>

                </div>
            </SheetContent>
        </Sheet >

    )
}

export default DailyChallengeSheet