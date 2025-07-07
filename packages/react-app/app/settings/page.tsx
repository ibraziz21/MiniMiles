'use client'

import { Toaster } from '@/components/ui/sonner'
import { Chats, Copy, Envelope, Export, GithubLogo, TwitterLogo } from '@phosphor-icons/react/dist/ssr'
import React from 'react'
import { toast } from 'sonner'

const SettingsPage = () => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            toast("Link Copied!")
        }).catch(() => {
            toast("Failed to copy");
        });
    }

    return (
        <div className='p-3 font-sterling'>
            <div className="min-h-[110px]  flex flex-col justify-around">
                <h1 className="text-2xl font-medium">Settings</h1>
                <h3 className='font-extralight'>Your account details</h3>
            </div>

            <h3 className='font-medium'>Account</h3>

            <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <h3 className='font-light text-[#00000080]'>Username</h3>
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">username.mini</h2>
                    <Copy size={24} className="cursor-pointer" onClick={() => handleCopy('username.mini')} />
                </div>
            </div>

            <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <h3 className='font-light text-[#00000080]'>Paired address</h3>
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">0xA56..78E3</h2>
                    <div className='flex justify-center space-x-2'>
                        <Copy size={24} className="cursor-pointer" onClick={() => handleCopy('0xA56..78E3')} />
                        <Export size={24} />
                    </div>
                </div>
            </div>

            <h3 className='font-medium'>Contact Us</h3>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <Envelope size={24} className="mr-2" color="#238D9D" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">Support@minimiles.co</h2>
                    <Copy size={24} className="cursor-pointer" onClick={() => handleCopy('Support@minimiles.co')} />
                </div>
            </div>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <Chats size={24} className="mr-2" color="#238D9D" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">Chat with us</h2>
                    <Export size={24} />
                </div>
            </div>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <TwitterLogo size={24} className="mr-2" color="#238D9D" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">Message us</h2>
                    <Export size={24} />
                </div>
            </div>

            <h3 className='font-medium'>Source code</h3>

            <div className="flex justify-between items-start shadow-lg rounded-xl p-4 text-[#00000080] my-2 bg-white">
                <GithubLogo size={24} className="mr-2" color="#238D9D" />
                <div className="flex justify-between items-center w-full">
                    <h2 className="font-medium text-black">View open source code</h2>
                    <Export size={24} />
                </div>
            </div>
            <Toaster className='bg-white text-[#17C985]' />
        </div>
    )
}

export default SettingsPage
