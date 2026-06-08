'use client';

import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent } from './ui/sheet';
import Image from 'next/image';
import { claimPartnerQuest } from '@/helpers/partnerQuests';
import { useWeb3 } from '@/contexts/useWeb3';
import { akibaMilesSymbol } from '@/lib/svg';
import { Input } from './ui/input';
import type { Quest } from './partner-quests';

interface PartnerQuestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: Quest | null;
  setOpenSuccess?: (c: boolean) => void;
  onPretiumSubmit?: (questId: string) => void;
}

/* ────────────────────────────────────────────────────────── */
/* Username helpers – keep in sync with DB rules              */
/* ────────────────────────────────────────────────────────── */

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;

function normalizeUsernameInput(raw: string): string {
  if (!raw) return '';
  // Remove leading @, strip whitespace, lowercase
  const withoutAt = raw.replace(/^@+/, '');
  const withoutSpaces = withoutAt.replace(/\s+/g, '');
  return withoutSpaces.toLowerCase();
}

function validateUsername(username: string): string | null {
  if (!username) {
    return 'Please enter a username first.';
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Username must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters.`;
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return 'Username can only contain lowercase letters, numbers, and underscores (_).';
  }
  return null;
}

/* ────────────────────────────────────────────────────────── */
/* Component                                                  */
/* ────────────────────────────────────────────────────────── */

const PRETIUM_QUEST_TYPES = new Set(['pretium_signup', 'pretium_transact']);
const PRETIUM_REFERRAL_CODE = 'AKIBA1';

const EarnPartnerQuestSheet = ({
  open,
  onOpenChange,
  quest,
  setOpenSuccess,
  onPretiumSubmit,
}: PartnerQuestSheetProps) => {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pretiumSubmitted, setPretiumSubmitted] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null | undefined>(undefined);

  const { address, getUserAddress, waitForAuth } = useWeb3();

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  const isPretiumQuest = !!quest?.questType && PRETIUM_QUEST_TYPES.has(quest.questType);

  // Fetch email when a Pretium quest sheet opens
  useEffect(() => {
    if (!open || !isPretiumQuest || !address) return;
    setPretiumSubmitted(false);
    setUserEmail(undefined);
    fetch(`/api/users/${address}`)
      .then((r) => r.json())
      .then((data) => setUserEmail(data?.email ?? null))
      .catch(() => setUserEmail(null));
  }, [open, isPretiumQuest, address]);

  if (!quest) return null;

  const isUsernameQuest = quest.id === 'f18818cf-eec4-412e-8311-22e09a1332db';

  const normalizedUsername = isUsernameQuest
    ? normalizeUsernameInput(username)
    : '';

  const usernameValidationError =
    isUsernameQuest && normalizedUsername
      ? validateUsername(normalizedUsername)
      : isUsernameQuest && username.trim() === ''
      ? 'Please enter a username first.'
      : null;

  const handleClaim = async () => {
    if (!address) {
      alert('Wallet not connected');
      return;
    }

    try {
      await waitForAuth();
      setLoading(true);
      setError(null);

      if (isPretiumQuest) {
        if (!userEmail) {
          setError('Please add your email in your profile before submitting this quest.');
          setLoading(false);
          return;
        }
        const questType = quest.questType === 'pretium_signup' ? 'signup' : 'transact';
        const res = await fetch('/api/partner-quests/pretium/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questType }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.error === 'email-required') {
            throw new Error('Please add your email in your profile before submitting this quest.');
          }
          throw new Error(data?.message ?? data?.error ?? 'Submission failed');
        }
        setPretiumSubmitted(true);
        onPretiumSubmit?.(`pretium_${questType}`);
        setLoading(false);
        return;
      } else if (isUsernameQuest) {
        // ── Username quest: save username & award 50 Miles ──
        const normalized = normalizeUsernameInput(username);
        const clientErr = validateUsername(normalized || '');

        if (clientErr) {
          setError(clientErr);
          setLoading(false);
          return;
        }

        const res = await fetch('/api/partner-quests/username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: address,
            username: normalized,
          }),
        });

        if (!res.ok) {
          const text = await res.text();

          // Friendly handling of uniqueness / constraint errors
          if (/username/i.test(text) && /(exists|duplicate|23505)/i.test(text)) {
            throw new Error('That username is already taken. Please choose another one.');
          }

          throw new Error(text || 'Failed to save username quest');
        }
      } else {
        // ── Normal partner quests: open external app + claimPartnerQuest ──
        const isMiniPay =
          typeof window !== 'undefined' &&
          (window as any).ethereum?.isMiniPay;

        let destination = quest.actionLink;

        // Twitter-specific deep link logic (based on title)
        if (quest.title.toLowerCase().includes('twitter')) {
          destination = isMiniPay
            ? 'twitter://user?screen_name=akibaMilesApp'
            : 'https://twitter.com/akibaMilesApp';
        }

        if (destination) {
          if (isMiniPay) {
            window.location.href = destination;
          } else {
            window.open(destination, '_blank', 'noopener,noreferrer');
          }
        }

        const { error: claimError } = await claimPartnerQuest(address, quest.id);
        if (claimError) {
          throw new Error(claimError);
        }
      }

      setOpenSuccess?.(true);
      setUsername('');
      setError(null);
      onOpenChange(false);
    } catch (e: any) {
      console.error('[EarnPartnerQuestSheet] claim error', e);
      setError(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-sterling p-4"
      >
        <div className="flex justify-start items-center mb-2">
          <div className="rounded-full mr-2" style={{ backgroundColor: quest.color }}>
            <Image src={akibaMilesSymbol} alt="" className="h-[20px]" />
          </div>
          <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
            Partner Quest
          </h3>
        </div>

        <div className="mb-4">
          <h4 className="text-2xl font-medium">{quest.title}</h4>
          <p className="text-sm text-gray-500">{quest.description}</p>
        </div>

        <div className="bg-partner-quest bg-[#238D9D] rounded-xl p-3 text-center mb-4 text-white">
          <div className="flex justify-center items-center mb-1">
            <Image
              src={akibaMilesSymbol}
              width={32}
              height={32}
              alt={quest.title}
            />
            <span className="text-3xl font-medium ml-2">
              {quest.reward.split(' ')[0]}
            </span>
          </div>
          <span className="text-sm uppercase">akibaMiles</span>
        </div>

        <div className="mb-6 font-poppins">
          {isPretiumQuest ? (
            pretiumSubmitted ? (
              <div className="rounded-xl bg-[#FEF3C7] p-4 text-center">
                <p className="text-base font-semibold text-[#92400E]">Submitted!</p>
                <p className="mt-1 text-sm text-[#78350F]">
                  Pretium verifies accounts daily. Your miles will be awarded within 24 hours of confirmation.
                </p>
              </div>
            ) : (
              <>
                {quest.questType === 'pretium_signup' && (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-black mb-1">
                      You MUST use this referral code:
                    </p>
                    <div className="flex items-center justify-between rounded-xl border-2 border-[#238D9D] bg-[#F0FDFF] px-4 py-3">
                      <span className="text-2xl font-bold tracking-widest text-[#238D9D]">
                        {PRETIUM_REFERRAL_CODE}
                      </span>
                      <button
                        type="button"
                        className="text-sm font-semibold text-[#238D9D] underline"
                        onClick={() => navigator.clipboard?.writeText(PRETIUM_REFERRAL_CODE)}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-red-500 font-medium">
                      Accounts registered without code AKIBA1 cannot be verified.
                    </p>
                  </div>
                )}

                <div className="mb-3 rounded-xl bg-[#FEF9EC] border border-[#FCD34D] px-3 py-2">
                  <p className="text-xs text-[#78350F]">
                    <span className="font-semibold">Verification required:</span> Miles are awarded after Pretium confirms your activity — not immediately. Pretium runs verifications daily.
                  </p>
                </div>

                <h5 className="font-medium mb-2">Instructions</h5>
                <ol className="list-decimal list-inside space-y-2 text-[#8E8B8B]">
                  {quest.instructions.map((step, i) => (
                    <li key={i}>
                      <strong className="text-black font-semibold">{step.title}:</strong>{' '}
                      {step.text}
                    </li>
                  ))}
                </ol>
                {userEmail === null && (
                  <p className="mt-3 text-xs text-amber-600 font-medium">
                    ⚠ You need to add your email in your profile before submitting.
                  </p>
                )}
                {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
              </>
            )
          ) : isUsernameQuest ? (
            <>
              <h5 className="font-medium mb-2">Set your Akiba username</h5>
              <p className="text-sm text-[#8E8B8B] mb-3">
                This is the name we&apos;ll show on leaderboards, raffles, and future
                rewards. Usernames:
                <br />
                <span className="text-[11px]">
                  • 3–32 characters • lowercase letters, numbers, and{' '}
                  <code>_</code> only • no spaces
                </span>
              </p>
              <div className="space-y-2">
                <Input
                  placeholder="@yourhandle"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                />
                {normalizedUsername && (
                  <p className="text-[11px] text-[#8E8B8B]">
                    We&apos;ll save this as{' '}
                    <span className="font-semibold">@{normalizedUsername}</span>
                  </p>
                )}
                <p className="text-[11px] text-[#8E8B8B]">
                  Example: <span className="font-semibold">@akibalegend</span>
                </p>
              </div>
              {(error || usernameValidationError) && (
                <p className="mt-2 text-xs text-red-500">{error || usernameValidationError}</p>
              )}
            </>
          ) : (
            <>
              <h5 className="font-medium mb-2">Instructions</h5>
              <ol className="list-decimal list-inside space-y-2 text-[#8E8B8B]">
                {quest.instructions.map((step, i) => (
                  <li key={i}>
                    <strong className="text-black font-semibold">{step.title}:</strong>{' '}
                    {step.text}
                  </li>
                ))}
              </ol>
              {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            </>
          )}
        </div>

        {isPretiumQuest ? (
          pretiumSubmitted ? (
            <Button
              className="w-full rounded-xl py-6 text-[#238D9D] bg-[#238D9D1A] mb-2"
              title="Close"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Primary CTA — opens Play Store */}
              <Button
                className="w-full rounded-xl py-6 text-white bg-[#238D9D] mb-0"
                title="Get Pretium on Play Store"
                onClick={() => {
                  window.location.href = quest.actionLink;
                }}
              >
                Get Pretium on Play Store
              </Button>
              {/* Secondary — submit after completing the quest */}
              <Button
                className="w-full rounded-xl py-5 text-[#238D9D] bg-[#238D9D1A]"
                title={loading ? 'Submitting…' : "I've done it — Submit Quest"}
                onClick={handleClaim}
                disabled={loading || userEmail === null}
              >
                {loading ? 'Submitting…' : "I’ve done it — Submit Quest"}
              </Button>
            </div>
          )
        ) : (
          <Button
            className="w-full rounded-xl py-6 text-white bg-[#238D9D] mb-2"
            title={
              loading
                ? 'Processing…'
                : isUsernameQuest
                ? 'Save username & Earn'
                : 'Complete & Earn'
            }
            onClick={handleClaim}
            disabled={loading || (isUsernameQuest && !!usernameValidationError)}
          >
            {loading
              ? 'Processing…'
              : isUsernameQuest
              ? 'Save username & Earn'
              : 'Complete & Earn'}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default EarnPartnerQuestSheet;
