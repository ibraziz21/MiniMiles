'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWeb3 } from '@/contexts/useWeb3';
import { Check, PencilSimple, X, Gift } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import truncateEthAddress from 'truncate-eth-address';
import Image from 'next/image';
import { akibaMilesSymbol } from '@/lib/svg';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

/* ─── types ──────────────────────────────────────────────────── */
interface ProfileData {
  is_member: boolean;
  username: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  twitter_handle: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  interests: string[] | null;
  profile_milestone_50_claimed: boolean;
  profile_milestone_100_claimed: boolean;
  completion: number;
}

const INTERESTS_OPTIONS = [
  'DeFi', 'Gaming', 'NFTs', 'Payments',
  'Savings', 'Staking', 'Travel', 'Shopping',
];

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia',
  'Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Benin',
  'Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Bulgaria','Burkina Faso',
  'Burundi','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile',
  'China','Colombia','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Dominican Republic','DR Congo','Ecuador','Egypt','El Salvador',
  'Estonia','Ethiopia','Finland','France','Gabon','Gambia','Georgia','Germany',
  'Ghana','Greece','Guatemala','Guinea','Haiti','Honduras','Hungary','India',
  'Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica',
  'Japan','Jordan','Kazakhstan','Kenya','Kosovo','Kuwait','Kyrgyzstan','Laos',
  'Latvia','Lebanon','Liberia','Libya','Lithuania','Luxembourg','Madagascar',
  'Malawi','Malaysia','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova',
  'Mongolia','Morocco','Mozambique','Myanmar','Namibia','Nepal','Netherlands',
  'New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia',
  'Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal',
  'Serbia','Sierra Leone','Singapore','Slovakia','Slovenia','Somalia',
  'South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand',
  'Togo','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Uganda',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay',
  'Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
];

/* ─── SVG progress ring ──────────────────────────────────────── */
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ProgressRing({ pct }: { pct: number }) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="absolute inset-0">
      <circle cx="48" cy="48" r={RADIUS} fill="none" stroke="#E5E7EB" strokeWidth="5" />
      <circle
        cx="48" cy="48" r={RADIUS}
        fill="none" stroke="#238D9D" strokeWidth="5"
        strokeDasharray={`${CIRCUMFERENCE}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

/* ─── inline edit row ────────────────────────────────────────── */
function EditRow({
  label,
  value,
  placeholder,
  onSave,
  type = 'text',
  isLast = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => Promise<void>;
  type?: string;
  isLast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    if (draft.trim() === value.trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between ${isLast ? '' : 'border-b border-gray-100'}`}>
      <div className="min-w-0 flex-1 sm:pr-3">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
        {editing ? (
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setDraft(value); setEditing(false); }
            }}
            className="block w-full max-w-full min-w-0 text-sm font-medium text-gray-900 border-b-2 border-[#238D9D] outline-none bg-transparent pb-0.5"
            placeholder={placeholder}
          />
        ) : (
          <p className="text-sm font-medium text-gray-900 truncate">
            {value || <span className="text-gray-400 font-normal italic">{placeholder ?? 'Tap to set'}</span>}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5 self-end sm:self-auto">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="p-1.5 rounded-full bg-[#238D9D]/10 text-[#238D9D] disabled:opacity-50"
            >
              <Check size={15} weight="bold" />
            </button>
            <button
              onClick={() => { setDraft(value); setEditing(false); }}
              className="p-1.5 rounded-full bg-gray-100 text-gray-500"
            >
              <X size={15} weight="bold" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors"
          >
            <PencilSimple size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Bio row (textarea) ─────────────────────────────────────── */
function BioRow({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const handleSave = async () => {
    if (draft.trim() === value.trim()) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div className="py-3.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide">Bio</p>
        <div className="flex flex-shrink-0 gap-1.5">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="p-1.5 rounded-full bg-[#238D9D]/10 text-[#238D9D] disabled:opacity-50">
                <Check size={15} weight="bold" />
              </button>
              <button onClick={() => { setDraft(value); setEditing(false); }}
                className="p-1.5 rounded-full bg-gray-100 text-gray-500">
                <X size={15} weight="bold" />
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="p-1.5 rounded-full hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors">
              <PencilSimple size={16} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 200))}
            rows={3}
            className="w-full text-sm text-gray-900 border border-[#238D9D] rounded-xl p-3 outline-none resize-none"
            placeholder="Tell people a bit about yourself..."
          />
          <p className="text-xs text-gray-400 text-right mt-0.5">{draft.length}/200</p>
        </>
      ) : (
        <p className="text-sm font-medium text-gray-900">
          {value || <span className="text-gray-400 font-normal italic">Tap to set</span>}
        </p>
      )}
    </div>
  );
}

/* ─── Country dropdown row ───────────────────────────────────── */
function CountryRow({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const handleSave = async () => {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100">
      <div className="min-w-0 flex-1 sm:pr-3">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">Country</p>
        {editing ? (
          <select
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="block w-full text-sm font-medium text-gray-900 border-b-2 border-[#238D9D] outline-none bg-transparent pb-0.5"
          >
            <option value="">Select a country</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm font-medium text-gray-900 truncate">
            {value || <span className="text-gray-400 font-normal italic">Tap to set</span>}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5 self-end sm:self-auto">
        {editing ? (
          <>
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-full bg-[#238D9D]/10 text-[#238D9D] disabled:opacity-50">
              <Check size={15} weight="bold" />
            </button>
            <button onClick={() => { setDraft(value); setEditing(false); }}
              className="p-1.5 rounded-full bg-gray-100 text-gray-500">
              <X size={15} weight="bold" />
            </button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors">
            <PencilSimple size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Milestone card ─────────────────────────────────────────── */
function MilestoneCard({
  pct,
  points,
  claimed,
  completion,
  onClaim,
}: {
  pct: 50 | 100;
  points: number;
  claimed: boolean;
  completion: number;
  onClaim: (token: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [awaitingToken, setAwaitingToken] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const unlocked = completion >= pct;

  const handle = () => {
    if (!unlocked || claimed || loading) return;
    setAwaitingToken(true);
    turnstileRef.current?.execute();
  };

  const onToken = async (token: string) => {
    setAwaitingToken(false);
    setLoading(true);
    try {
      await onClaim(token);
    } finally {
      setLoading(false);
      turnstileRef.current?.reset();
    }
  };

  return (
    <div className={`rounded-2xl p-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center
      ${claimed ? 'bg-[#CFF2E5] border border-[#238D9D]/20' : unlocked ? 'bg-white shadow-sm border border-gray-100' : 'bg-gray-50 border border-gray-100'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
        ${claimed ? 'bg-[#238D9D]/20' : unlocked ? 'bg-[#238D9D]/10' : 'bg-gray-200'}`}>
        <Gift size={18} weight="duotone" color={unlocked || claimed ? '#238D9D' : '#9CA3AF'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500">{pct}% profile complete</p>
        <div className="flex items-center gap-1 mt-0.5">
          <Image src={akibaMilesSymbol} alt="AkibaMiles" width={16} height={16} />
          <span className="text-sm font-bold text-gray-800">{points}</span>
        </div>
      </div>
      {claimed ? (
        <span className="self-end text-xs font-bold text-[#238D9D] bg-white px-3 py-1.5 rounded-full border border-[#238D9D]/20 flex-shrink-0 sm:self-auto">
          Claimed ✓
        </span>
      ) : (
        <button
          onClick={handle}
          disabled={!unlocked || loading || awaitingToken}
          className={`self-end text-xs font-bold px-3 py-1.5 rounded-full transition-all flex-shrink-0 sm:self-auto
            ${unlocked
              ? 'bg-[#238D9D] text-white active:scale-95 shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
        >
          {loading || awaitingToken ? '…' : unlocked ? 'Claim' : `${pct - completion}% to go`}
        </button>
      )}
      {/* Invisible Turnstile — executes manually when Claim is tapped */}
      {unlocked && !claimed && (
        <Turnstile
          ref={turnstileRef}
          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
          options={{ execution: 'execute', appearance: 'interaction-only' }}
          onSuccess={onToken}
          onError={() => { setAwaitingToken(false); toast.error('Verification failed. Please try again.'); turnstileRef.current?.reset(); }}
          onExpire={() => { setAwaitingToken(false); turnstileRef.current?.reset(); }}
        />
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */
export default function ProfilePage() {
  const { address, waitForAuth } = useWeb3();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/users/${address}`);
      const json = await res.json();
      if (res.ok) setProfile(json);
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const patchField = async (field: string, value: any) => {
    if (!address) return;
    const res = await fetch(`/api/users/${address}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? 'Update failed');
      throw new Error(json.error);
    }
    toast.success('Saved');
    await loadProfile();
  };

  const toggleInterest = async (interest: string) => {
    if (!profile) return;
    const current = profile.interests ?? [];
    const next = current.includes(interest)
      ? current.filter(i => i !== interest)
      : [...current, interest];
    await patchField('interests', next);
  };

  const claimMilestone = async (milestone: 50 | 100, turnstileToken: string) => {
    if (!address) return;
    await waitForAuth();
    const res = await fetch('/api/profile/claim-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress: address, milestone, turnstileToken }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error === 'already-claimed' ? 'Already claimed' : json.error ?? 'Claim failed');
      return;
    }
    toast.success(`+${json.points} AkibaMiles claimed!`);
    // Optimistically flip the flag — do NOT call loadProfile() here because
    // the background fetch would race and overwrite this with the DB value
    // before the queued mint job has had a chance to set the flag.
    setProfile(prev => {
      if (!prev) return prev;
      const field = milestone === 50
        ? 'profile_milestone_50_claimed'
        : 'profile_milestone_100_claimed';
      return { ...prev, [field]: true };
    });
  };

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : profile?.username
    ? profile.username.slice(0, 2).toUpperCase()
    : address
    ? address.slice(2, 4).toUpperCase()
    : '??';

  const displayName = profile?.full_name ?? profile?.username ?? null;
  const completion = profile?.completion ?? 0;

  if (!address) {
    return (
      <main className="flex items-center justify-center min-h-screen font-sterling">
        <p className="text-gray-500">Connect your wallet to view your profile.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-onboarding pb-24 font-sterling">
      <Toaster richColors />

      {/* Header */}
      <div className="px-4 min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Profile</h1>
        <h3 className="font-extralight">Build your identity on AkibaMiles.</h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#238D9D] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Hero card */}
          <div className="mx-4 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
            {/* Avatar + ring */}
            <div className="relative w-24 h-24 flex-shrink-0">
              <ProgressRing pct={completion} />
              <div className="absolute inset-[10px] rounded-full bg-[#238D9D] flex items-center justify-center overflow-hidden">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-xl font-bold select-none">{initials}</span>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-gray-900 truncate">
                {displayName ?? <span className="text-gray-400 font-normal italic">No name set</span>}
              </p>
              {profile?.username && displayName !== profile.username && (
                <p className="text-xs text-gray-400">@{profile.username}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{truncateEthAddress(address)}</p>

              {/* Progress bar */}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#238D9D] rounded-full transition-all duration-500"
                    style={{ width: `${completion}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-[#238D9D] tabular-nums">{completion}%</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Profile complete</p>
            </div>
          </div>

          {/* Profile fields */}
          <div className="mx-4 mt-4 bg-white rounded-2xl px-4 pt-1 pb-1 shadow-sm border border-gray-100">
            <EditRow label="Username" value={profile?.username ?? ''} placeholder="e.g. akiba_user" onSave={v => patchField('username', v)} />
            <EditRow label="Full Name" value={profile?.full_name ?? ''} placeholder="Your full name" onSave={v => patchField('full_name', v)} />
            <EditRow label="Email" value={profile?.email ?? ''} placeholder="you@example.com" type="email" onSave={v => patchField('email', v)} />
            <EditRow label="Phone" value={profile?.phone ?? ''} placeholder="+2547XXXXXXXX" type="tel" onSave={v => patchField('phone', v)} />
            <EditRow label="Twitter / X" value={profile?.twitter_handle ?? ''} placeholder="@handle" onSave={v => patchField('twitter_handle', v)} />
            <CountryRow value={profile?.country ?? ''} onSave={v => patchField('country', v)} />
            <BioRow value={profile?.bio ?? ''} onSave={v => patchField('bio', v)} />
          </div>

          {/* Interests */}
          <div className="mx-4 mt-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-3">Interests</p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS_OPTIONS.map(interest => {
                const active = (profile?.interests ?? []).includes(interest);
                return (
                  <button
                    key={interest}
                    onClick={() => toggleInterest(interest)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all
                      ${active
                        ? 'bg-[#238D9D] text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Milestone rewards */}
          <div className="mx-4 mt-4 mb-2">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-3 px-1">Profile rewards</p>
            <div className="flex flex-col gap-3">
              <MilestoneCard
                pct={50}
                points={20}
                claimed={profile?.profile_milestone_50_claimed ?? false}
                completion={completion}
                onClaim={(token) => claimMilestone(50, token)}
              />
              <MilestoneCard
                pct={100}
                points={30}
                claimed={profile?.profile_milestone_100_claimed ?? false}
                completion={completion}
                onClaim={(token) => claimMilestone(100, token)}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
