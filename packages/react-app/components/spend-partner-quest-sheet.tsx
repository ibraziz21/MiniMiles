import React from 'react'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Celo, MinimilesSymbolAlt, Ticket } from '@/lib/svg';
import Image from 'next/image';

interface PartnerQuestSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const SpendPartnerQuestSheet = ({ open, onOpenChange }: PartnerQuestSheetProps) => {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side={"bottom"} className="bg-white rounded-t-xl font-poppins">
                <div className="bg-white">
                    <div className='flex items-center'>
                        <div className="bg-[#24E5E033] rounded-full flex justify-center ml-2">
                            <h3 className='text-[#1E8C89] text-sm font-bold px-2'>Daily Challenge</h3>
                        </div>
                    </div>
                    <h4 className='text-2xl font-bold'>Weekly Raffle</h4>

                    <div className="bg-partner-quest bg-[#219653] bg-no-repeat bg-cover text-white text-center rounded-xl py-2">
                        <div className="flex items-center justify-center my-3">
                            <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
                            <p className="text-3xl font-bold pl-2">5</p>
                        </div>
                        <h4>MiniMiles</h4>
                    </div>

                    <div className="">
                        <h3 className="text-gray-500 text-sm font-medium mb-4">Join our weekly raffle of 500 cUSD and win big. </h3>
                        <p>Raffle Details</p>
                        <ol className="list-decimal list-inside space-y-2 text-gray-800 text-sm my-2">
                            <li className='flex'>
                                <div className='flex justify-between'>
                                    <h4 className='font-bold'>
                                        Prize
                                    </h4>
                                    <p className='text-[#8E8B8B]'>500 cUSD</p>
                                </div>
                            </li>
                            <li className='flex'>
                                <div className='flex justify-between'>
                                    <h4 className='font-bold'>
                                        Ticket Price
                                    </h4>
                                    <p className='text-[#8E8B8B]'>25/05/2025 (in 5 days)</p>
                                </div>
                            </li>
                        </ol>
                    </div>

                    <h3>Buy Tickets</h3>
                    <div>
                        <Image src={Ticket} alt=''  />
                        <h4 className='font-bold text-[#07955F]'>10</h4>
                    </div>
                    <Button title="Buy"
                        onClick={() => { }} className="w-full rounded-xl py-6 flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-white bg-[#07955F] hover:bg-[#07955F]
                    disabled:bg-[#07955F]"></Button>
                    <p className="text-center text-[10px] text-gray-400 mt-2">
                    25/05/2025 (in 5 days)
                    </p>

                </div>
            </SheetContent>
        </Sheet >

    )
}

export default SpendPartnerQuestSheet