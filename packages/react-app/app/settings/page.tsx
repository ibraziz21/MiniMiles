'use client';

import { Toaster } from '@/components/ui/sonner';
import { useWeb3 } from '@/contexts/useWeb3';
import {
  Chats,
  Copy,
  Envelope,
  Export,
  GithubLogo,
  TwitterLogo,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import React, { useEffect } from 'react';
import { toast } from 'sonner';
import truncateEthAddress from 'truncate-eth-address';

export default function SettingsPage() {
  const { address, getUserAddress } = useWeb3();

  /* copy helper --------------------------------------------------------- */
  const handleCopy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast('Link Copied!'))
      .catch(() => toast('Failed to copy'));
  };

  /* fetch wallet once on mount ----------------------------------------- */
  useEffect(() => {
    getUserAddress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------------------------- */
  return (
    <div
      className="p-3 font-sterling min-h-screen overflow-y-auto flex flex-col"
    >
      <header className="min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Settings</h1>
        <h3 className="font-extralight">Your account details</h3>
      </header>

      {/* ───── Account ───── */}
      <h3 className="font-medium">Account</h3>

      <div className="flex flex-col shadow-lg rounded-xl p-4 my-2 bg-white">
        <span className="text-[#00000080] font-light">Paired address</span>
        <div className="flex justify-between items-center w-full">
          <span className="font-medium">
            {truncateEthAddress(address ?? '')}
          </span>
          <Copy
            size={24}
            className="cursor-pointer"
            onClick={() => handleCopy(address ?? '')}
          />
        </div>
      </div>

      {/* ───── Contact Us ───── */}
      <h3 className="font-medium">Contact Us</h3>

      <SettingRow
        icon={<Envelope size={24} color="#219653" />}
        label="hello@akibamiles.com"
        onCopy={() => handleCopy('hello@akibamiles.com')}
      />

      <SettingRow
        icon={<Chats size={24} color="#219653" />}
        label="Chat with us"
        link="https://t.me/+oRfjEWyA4zo5NTRk"
      />

      <SettingRow
        icon={<TwitterLogo size={24} color="#219653" />}
        label="Message us"
        link="https://x.com/minimilesapp"
      />

      {/* ───── Source code ───── */}
      <h3 className="font-medium">Source code</h3>

      <SettingRow
        icon={<GithubLogo size={24} color="#219653" />}
        label="View open-source code"
        link="https://github.com/ibraziz21/MiniMiles"
      />

      {/* ───── Footer links ───── */}
      <footer className="mt-4 flex space-x-2 text-sm text-[#00000080]">
        <FooterLink href="https://www.akibamiles.com/terms-of-use">
          Terms of Service
        </FooterLink>
        <span>•</span>
        <FooterLink href="https://www.akibamiles.app/privacy-policy">
          Privacy Policy
        </FooterLink>
      </footer>

      {/* toast portal */}
      <Toaster richColors />
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function SettingRow({
  icon,
  label,
  link,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  link?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-start shadow-lg rounded-xl p-4 my-2 bg-white">
      <span className="mr-2">{icon}</span>
      <div className="flex justify-between items-center w-full">
        <span className="font-medium text-black">{label}</span>
        {link ? (
          <Link href={link} target="_blank">
            <Export size={24} />
          </Link>
        ) : (
          <Copy size={24} className="cursor-pointer" onClick={onCopy} />
        )}
      </div>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" className="hover:underline">
      {children}
    </a>
  );
}
