'use client'

import { Toaster } from '@/components/ui/sonner'
import { useWeb3 } from '@/contexts/useWeb3'
import { Chats, Copy, Envelope, Export, GithubLogo, TwitterLogo } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import truncateEthAddress from "truncate-eth-address";

const SettingsPage = () => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            toast("Link Copied!")
        }).catch(() => {
            toast("Failed to copy");
        });
    }

    const { address, getUserAddress } = useWeb3();



    useEffect(() => {
        getUserAddress();
      }, []);

     
    return (
        <div className='p-3 font-sterling'>
            <div className="min-h-[110px]  flex flex-col justify-around">
                <h1 className="text-2xl font-medium">Settings</h1>
                <h3 className='font-extralight'>Your account details</h3>
            </div>

            <h3 className='font-medium'>Account</h3>


            <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <h3 className='font-light text-[#00000080]'>Paired address</h3>
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">{truncateEthAddress(address ?? "")}</h2>
                    <div className='flex justify-center space-x-2'>
                        <Copy size={24} className="cursor-pointer" onClick={() => handleCopy('0xA56..78E3')} />
                       
                    </div>
                </div>
            </div>

            <h3 className='font-medium'>Contact Us</h3>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <Envelope size={24} className="mr-2" color="#219653" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">hello@minimiles.app</h2>
                    <Copy size={24} className="cursor-pointer" onClick={() => handleCopy('Support@minimiles.co')} />
                </div>
            </div>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <Chats size={24} className="mr-2" color="#219653" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">Chat with us</h2>
                    <Link href='https://t.me/+oRfjEWyA4zo5NTRk'>
                    <Export size={24} />
                    </Link>
                </div>
            </div>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <TwitterLogo size={24} className="mr-2" color="#219653" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">Message us</h2>
                    <Link href='https://x.com/minimilesapp'>
                    <Export size={24} />
                    </Link>
                </div>
            </div>

            <h3 className='font-medium'>Source code</h3>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <GithubLogo size={24} className="mr-2" color="#219653" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">View open source code</h2>
                    <Link href='https://github.com/ibraziz21/MiniMiles'>
                    <Export size={24} />
                    </Link>
                </div>
            </div>
            <div className="mt-4 flex space-x-4 text-sm text-[#00000080]">
      <a href="https://www.minimiles.app/terms-of-use" className="hover:underline" target="_blank">
        Terms of Service
      </a>
      <span>•</span>
      <a href="https://www.minimiles.app/privacy-policy" className="hover:underline" target="_blank">
        Privacy Policy
      </a>
    </div>
            <Toaster className='bg-white text-[#17C985]' />
        </div>
    )
}

export default SettingsPage
