# Akiba Hub — Product Architecture & Design Document
**Version 1.1 | June 2026**
> **Updated:** Hub App is a native mobile app published to Google Play Store and Apple App Store (built with Expo / React Native), not a PWA. Hub Page remains Next.js web.

---

## Table of Contents

1. [Product Architecture Overview](#1-product-architecture-overview)
2. [UX Flows](#2-ux-flows)
3. [Sitemap & Navigation](#3-sitemap--navigation)
4. [Component Architecture](#4-component-architecture)
5. [Data Model & Schema](#5-data-model--schema)
6. [Recommendation Scoring Logic](#6-recommendation-scoring-logic)
7. [Notification Logic](#7-notification-logic)
8. [Partner Campaign Workflow](#8-partner-campaign-workflow)
9. [MVP Scope — First 4 Weeks](#9-mvp-scope--first-4-weeks)
10. [What to Avoid Overbuilding](#10-what-to-avoid-overbuilding)
11. [App Store & Play Store Considerations](#11-app-store--play-store-considerations)
12. [Open Questions & Assumptions](#12-open-questions--assumptions)
13. [Milestones & Acceptance Criteria](#13-milestones--acceptance-criteria)

---

## 1. Product Architecture Overview

### 1.1 Surface Map

```
┌─────────────────────────────────────────────────────────┐
│                  AkibaMiles Ecosystem                   │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │  Akiba Hub Page  │   │     Akiba Hub App        │   │
│  │  (Public/Web)    │   │  (Personalized/Logged-in)│   │
│  │                  │   │                          │   │
│  │  - Discovery     │   │  - For You feed          │   │
│  │  - Featured      │   │  - Earn / Play / Redeem  │   │
│  │  - No login      │   │  - Explore / Profile     │   │
│  │  - CTAs to App   │   │  - Wallet linking        │   │
│  └────────┬─────────┘   └────────────┬─────────────┘   │
│           │                          │                  │
│           └──────────┬───────────────┘                  │
│                      │                                  │
│           ┌──────────▼───────────┐                      │
│           │   Akiba Core API     │                      │
│           │  (Campaigns, Offers, │                      │
│           │   Users, Rewards,    │                      │
│           │   Verification,      │                      │
│           │   Notifications)     │                      │
│           └──────────┬───────────┘                      │
│                      │                                  │
│     ┌────────────────┼─────────────────┐                │
│     │                │                 │                │
│  ┌──▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐         │
│  │MiniPay  │  │  Base App   │  │  Partner    │         │
│  │Mini-App │  │  Mini-App   │  │  Platform   │         │
│  │         │  │             │  │  (Admin +   │         │
│  │Quests   │  │Games        │  │   API/SDK)  │         │
│  │Raffles  │  │On-chain     │  │             │         │
│  │Wallet   │  │Base quests  │  │             │         │
│  │actions  │  │Base raffles │  │             │         │
│  └─────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend (Hub Page) | Next.js (App Router) | SSR for SEO, public web discovery |
| Frontend (Hub App) | **Expo (React Native)** | Native iOS + Android, Play Store + App Store |
| Mini-Apps | React (MiniPay SDK / Base Mini-App SDK) | Ecosystem web mini-app constraints |
| Backend API | Next.js API routes (on Hub Page host) | Monorepo colocation, Vercel deployment |
| Database | Supabase (Postgres) | Auth, RLS, real-time, storage |
| Auth | Supabase Auth (OTP via email/phone) | No wallet-only login; works natively in Expo |
| Cache / Queue | Redis (Upstash) | Scoring cache, notification queue |
| Verification | Webhooks + on-chain listeners (Viem/Ethers) | Campaign action verification |
| Push Notifications | **Expo Push Notifications → FCM (Android) + APNs (iOS)** | Native push; MVP requirement for a store app |
| Email Notifications | Resend | Transactional email (rewards, raffle results) |
| Analytics | Supabase + PostHog | Campaign analytics, in-app funnel tracking |
| Monorepo | Turborepo | Shared packages between web and native |
| OTA Updates | Expo EAS Update | Ship JS/asset fixes without full store review |
| Store Builds | Expo EAS Build | Managed build pipeline for Play Store + App Store |

#### Why Expo over bare React Native
- EAS Build handles the iOS/Android build pipeline without maintaining native Xcode/Gradle configs
- Expo Push Notifications is a single API that routes to FCM and APNs — no need to manage two SDKs
- EAS Update allows hotfixes to campaign logic, UI, and scoring without waiting for store review cycles (critical for time-sensitive campaigns)
- Expo's ecosystem covers wallet connect, deep linking, secure storage (for auth tokens), and camera/biometrics if needed later

### 1.3 Monorepo Structure

```
akibamiles/
├── apps/
│   ├── hub-page/          # Public Next.js site (web, Vercel)
│   ├── hub-app/           # Expo React Native app (iOS + Android)
│   │   ├── app/           # Expo Router file-based navigation
│   │   ├── components/    # Native-specific components
│   │   ├── hooks/         # Data fetching hooks
│   │   └── app.json       # Expo config (bundle ID, permissions, etc.)
│   ├── minipay-app/       # MiniPay mini-app (web React)
│   └── base-app/          # Base mini-app (web React)
├── packages/
│   ├── react-app/         # Existing shared UI (web-only — do not import in hub-app)
│   ├── ui-native/         # NEW: React Native shared components (OfferCard, etc.)
│   ├── ui-web/            # Shared web UI for Hub Page
│   ├── api-client/        # Typed API client (platform-agnostic, shared)
│   ├── scoring/           # Recommendation scoring logic (platform-agnostic, shared)
│   └── types/             # Shared TypeScript types (platform-agnostic)
├── supabase/
│   ├── migrations/        # DB schema migrations
│   └── functions/         # Edge functions (notifications, webhooks)
└── docs/
    └── architecture/
```

> **Key constraint:** `packages/react-app` uses web DOM APIs and cannot be imported into the Expo app. Native UI lives in `packages/ui-native`, using React Native primitives. Business logic (scoring, API client, types) is platform-agnostic and shared freely.

### 1.4 Core Architectural Principles

**Offer Card as the Universal Primitive.** Every reward surface — campaign, voucher, game, raffle, quest, promo — is represented as a normalized Offer Card. This lets the same rendering component work across Hub Page, Hub App, and mini-apps with different data hydration.

**Identity-first, wallet-optional.** Users log in with email/phone OTP. Wallets are linked credentials, not the account. This lowers the onboarding floor and allows non-crypto users to engage.

**Personalization as a scoring layer, not a ML black box.** V1 uses rules-based scoring that is transparent, debuggable, and can be tuned by the team. ML is explicitly post-MVP.

**Verification is a contract.** Each campaign defines its verification method upfront. Akiba does not issue rewards without a verified signal. This protects partners and prevents fraud.

---

## 2. UX Flows

### 2.1 Existing AkibaMiles User Flow

```
User opens Akiba Hub App
        │
        ▼
Enter email or phone
        │
        ▼
Receive OTP → Enter OTP
        │
        ▼
Supabase Auth verifies OTP
        │
        ▼
API: GET /users/me → Check akiba_users table
        │
   ┌────┴─────┐
   │  Found   │  → Load existing profile
   └────┬─────┘     AkibaMiles balance
        │            Prior campaigns / history
        ▼            Linked wallets
Check wallet linkage
        │
   ┌────┴────────────────────┐
   │  Missing wallets?        │
   │  Prompt to connect       │
   │  MiniPay / Base / EVM   │
   └────┬────────────────────┘
        │
        ▼
Check interest profile
   → If set: skip interest selection
   → If missing: show quick interest picker (≤30 seconds)
        │
        ▼
Run recommendation scoring engine
        │
        ▼
Render For You feed
        │
        ▼
User taps Offer Card
        │
        ▼
Route to:
   → MiniPay App (MiniPay quests/campaigns)
   → Base App (Base games/quests)
   → Partner deeplink (external campaign)
   → In-app action (voucher, raffle entry)
        │
        ▼
Action completed → Verification
        │
        ▼
Reward issued → AkibaMiles / voucher / raffle ticket credited
        │
        ▼
In-app confirmation + notification
```

### 2.2 New User Flow

```
User opens Akiba Hub App
        │
        ▼
Enter email or phone
        │
        ▼
Receive OTP → Enter OTP
        │
        ▼
API: GET /users/me → Not found → Create new akiba_user
        │
        ▼
Onboarding Screen 1: "What are you here for?"
   Select interests (multi-select, ≥1 required):
   □ Games & Challenges
   □ Vouchers & Discounts
   □ Raffles & Prize Draws
   □ DeFi & Wallet Rewards
   □ Partner Quests
   □ Leaderboards
        │
        ▼
Onboarding Screen 2: "Connect a wallet (optional)"
   □ Connect MiniPay Wallet
   □ Connect Base Wallet
   □ Connect Celo/EVM Wallet
   □ Skip for now
        │
        ▼
Onboarding Screen 3: "Reward preferences"
   □ Notify me about big rewards only
   □ All reward types
   □ Just vouchers
   (can change in Profile later)
        │
        ▼
Run recommendation scoring → For You feed
        │
        ▼
Show "Starter Offers" banner with low-friction first actions:
   → "Play your first Farkle game — earn 5 AkibaMiles"
   → "Complete profile — earn 10 AkibaMiles"
   → "Connect MiniPay wallet — unlock MiniPay rewards"
        │
        ▼
User begins earning
```

### 2.3 Partner-Triggered Campaign Flow

```
Partner configures campaign in Partner Platform
(campaign type, target segment, rewards, verification, budget, CTA)
        │
        ▼
Akiba admin reviews + approves campaign
        │
        ▼
Campaign saved to campaigns table: status = "scheduled" or "live"
        │
        ▼
Campaign publisher job runs:
   → Generates offer_cards for public Hub Page
   → Runs user matching:
      For each user:
        score = recommendation_engine.score(user, campaign)
        if score >= threshold:
          insert user_offer_recommendations(user_id, offer_id, score)
        │
        ▼
Notification dispatch (async queue):
   For eligible users with matching notification prefs:
   → Send push / email: "New [Games] reward: Play CrackPot on Base"
        │
        ▼
User opens Akiba Hub App
   → Sees campaign card in For You
   → personalized_reason: "Matches your Games interest + Base wallet"
        │
        ▼
User taps CTA: "Play CrackPot on Base"
   → Deep links to Base App / partner game
        │
        ▼
User plays game
        │
        ▼
Verification trigger:
   → Game API webhook fires to Akiba: { user_id, campaign_id, action_ref }
   OR
   → On-chain event listener detects qualifying transaction
        │
        ▼
Akiba verifies:
   → Check: action is for this user + this campaign
   → Check: campaign is still live + within budget
   → Check: daily/total limit not exceeded for this user
   → Check: fraud signals (device, timing, wallet age)
        │
        ▼
Reward issuance:
   → Credit AkibaMiles to user account
   → If raffle unlock: create raffle_entry record
   → Log reward_transaction
        │
        ▼
User sees in-app: "You earned 10 AkibaMiles! 2/3 plays to unlock $50 raffle."
        │
        ▼
Partner dashboard updates:
   → Campaign spend, completion count, reward issuance, funnel analytics
```

---

## 3. Sitemap & Navigation

### 3.1 Akiba Hub Page (Public Website)

```
/                          → Hero + Featured Offers
/campaigns                 → All live campaigns (filterable)
/campaigns/[slug]          → Campaign detail page
/vouchers                  → Available vouchers (generalized)
/games                     → Skill games & challenges
/raffles                   → Active raffles
/partners                  → Partner directory
/partners/[slug]           → Partner page + their campaigns
/explore/minipay           → MiniPay ecosystem page
/explore/base              → Base ecosystem page
/explore/merchants         → Merchant offers
/about                     → What is AkibaMiles?
/faq                       → How it works
```

**Hub Page CTA pattern:** Every offer card on the public page shows:
- "Open the app to check eligibility" → deeplink/redirect to Hub App
- Or ecosystem-specific: "Open MiniPay" / "Open Base App"

Never say "You qualify" on a public page.

### 3.2 Akiba Hub App (Personalized)

```
/app/                      → Redirect → /app/for-you (if logged in)
                                      → /app/login (if not)

/app/login                 → OTP login screen

/app/onboarding/interests  → Interest picker
/app/onboarding/wallets    → Wallet connect
/app/onboarding/prefs      → Reward preferences

── MAIN TABS ──────────────────────────────────────────────

/app/for-you               → Personalized recommendation feed
  Sections:
  - Best reward today (1 hero card)
  - Quick earns (horizontal scroll)
  - Ending soon
  - New on Base
  - MiniPay rewards
  - Vouchers in reach
  - Play & earn
  - Partner quests

/app/earn                  → All earning actions
  Sections:
  - Partner quests
  - Wallet actions
  - Social actions
  - Referral program
  - Streak rewards
  - Balance-hold campaigns

/app/play                  → Games, raffles, challenges
  Sections:
  - Skill games (Farkle, Memory Flip, Rule Tap)
  - Active raffles
  - Leaderboards
  - Base game campaigns
  - Gated rewards (locked/unlocked)

/app/redeem                → Vouchers & merchant offers
  Sections:
  - Available now (with current Miles)
  - Food & dining
  - Airtime & data
  - Shopping
  - Entertainment
  - Partner promos

/app/explore               → Broader discovery
  Sections:
  - MiniPay campaigns
  - Base campaigns
  - New launches
  - Featured partners
  - Merchants

/app/profile               → User identity & history
  Sections:
  - AkibaMiles balance + history
  - Linked wallets
  - Interests & preferences
  - Badges & streaks
  - Vouchers (active/used)
  - Completed campaigns
  - Raffle entries
  - Games played
  - Notification settings

── DETAIL PAGES ───────────────────────────────────────────

/app/offer/[offer_id]      → Offer Card detail + CTA
/app/campaign/[id]         → Campaign detail
/app/voucher/[id]          → Voucher detail + redeem
/app/raffle/[id]           → Raffle detail + entry
/app/game/[id]             → Game detail + launch
/app/partner/[slug]        → Partner page in-app
/app/settings/notifications → Notification preferences
/app/settings/wallets       → Manage wallets
```

---

## 4. Component Architecture

### 4.1 Native Components (packages/ui-native)

All Hub App UI is built with React Native primitives. Do not use HTML elements (`div`, `p`, `button`) here.

```
<OfferCard />                    (React Native View-based)
  Props: offer, displayMode ('compact' | 'standard' | 'hero'), showReason
  Variants:
    - CampaignCard
    - VoucherCard
    - GameCard
    - RaffleCard
    - QuestCard
  Sub-components:
    - <OfferBadge />             ecosystem tag (Base / MiniPay / Partner)
    - <RewardTag />              AkibaMiles / USDT / voucher chip
    - <EligibilityChip />        eligible / connect wallet / locked
    - <OfferCTA />               Pressable button + deep link / in-app routing
    - <OfferTimer />             countdown for ending soon (uses setInterval)
    - <PersonalizedReason />     "Matches your Games interest + Base wallet"

<OfferFeed />
  React Native FlatList (not ScrollView — critical for performance with 50+ cards)
  Props: sections[], loading, onRefresh (pull-to-refresh)
  Section headers rendered via SectionList for named feed sections

<BottomTabBar />
  Tabs: For You | Earn | Play | Redeem | Explore | Profile
  Built on React Navigation Bottom Tabs

<WalletConnector />
  Supports: MiniPay | Base | Celo/EVM
  Uses Linking.openURL() for wallet deeplinks
  State: connected / connecting / not connected

<MilesBalance />
  Animated number counter on balance change
  Trend indicator (up/down vs. last week)

<OnboardingFlow />
  Steps: interests → wallets → prefs
  React Native PagerView or Animated slide transitions
  Progress dots, skip options

<NotificationBell />
  Badge count overlay (Expo Notifications unread count)
  Taps open Notification Center bottom sheet

<StreakCard />
  Current streak, next milestone
  Visual flame/progress indicator

<BottomSheet />
  Offer detail, voucher redeem confirmation, raffle entry confirm
  Use @gorhom/bottom-sheet (proven RN library)
```

### 4.2 Navigation Structure (Expo Router)

Expo Router uses file-based routing, similar to Next.js App Router but for native screens.

```
apps/hub-app/app/
├── _layout.tsx              # Root layout, auth guard
├── (auth)/
│   ├── login.tsx            # OTP phone/email entry
│   └── verify.tsx           # OTP code input
├── (onboarding)/
│   ├── interests.tsx
│   ├── wallets.tsx
│   └── prefs.tsx
├── (tabs)/
│   ├── _layout.tsx          # Bottom tab navigator
│   ├── for-you.tsx          # For You feed
│   ├── earn.tsx
│   ├── play.tsx
│   ├── redeem.tsx
│   ├── explore.tsx
│   └── profile.tsx
├── offer/[id].tsx           # Offer detail screen
├── campaign/[id].tsx
├── voucher/[id].tsx
├── raffle/[id].tsx
├── game/[id].tsx
└── settings/
    ├── notifications.tsx
    └── wallets.tsx
```

### 4.3 Screen-Level Data Architecture (Hub App)

```
ForYouScreen
  → useScoredOffers(userId) — TanStack Query, stale time 5 min
  → Renders <OfferFeed /> with SectionList
  → Pull-to-refresh triggers rescore
  → Hero card = highest-scored eligible offer

EarnScreen
  → useEarnOffers(userId, filters)
  → Category filter chips (Partner / Wallet / Social / Referral)

PlayScreen
  → usePlayOffers(userId)
  → useRaffles(userId)
  → useLeaderboard() — refreshes every 15 min

RedeemScreen
  → useVouchers(userId, userMilesBalance)
  → "Affordable" section vs "Save X more miles" section

ExploreScreen
  → useAllCampaigns(filters)
  → Ecosystem filter: All / MiniPay / Base / Merchants

ProfileScreen
  → useUserProfile(userId)
  → useUserHistory(userId)
  → useLinkedWallets(userId)
```

### 4.4 Hub Page Components (apps/hub-page — web only)

```
<HeroSection />         Public hero with App Store / Play Store download CTAs
<FeaturedCampaigns />   Curated offer cards, no eligibility shown
<CategoryBrowser />     Filter by: Games / Vouchers / Raffles / Quests
<EcosystemStrip />      MiniPay | Base | Merchants
<PartnerShowcase />     Partner logos + active campaign count
<PublicOfferCard />     Web OfferCard, no personalized_reason
<AppDownloadCTA />      "Download Akiba Hub" — links to Play Store + App Store
```

The Hub Page CTAs should always route to the stores, not a web login, since the Hub App is native.

### 4.5 State Management (Hub App)

- **Server state:** TanStack Query (React Query) — all API calls, offers, user, campaigns
- **Auth state:** Supabase Auth client + `expo-secure-store` for token persistence
- **UI state:** Zustand — filter state, onboarding step, bottom sheet state
- **Push token:** Stored in Supabase (`user_push_tokens` table) on first notification permission grant
- **Real-time:** Supabase Realtime subscriptions for reward earned + raffle status changes

---

## 5. Data Model & Schema

### 5.1 Users & Identity

```sql
-- Core user account (email/phone login)
CREATE TABLE akiba_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE,
  phone           TEXT UNIQUE,
  display_name    TEXT,
  avatar_url      TEXT,
  akiba_miles     BIGINT DEFAULT 0,        -- current balance in points
  total_earned    BIGINT DEFAULT 0,
  total_spent     BIGINT DEFAULT 0,
  referral_code   TEXT UNIQUE,
  referred_by     UUID REFERENCES akiba_users(id),
  streak_count    INT DEFAULT 0,
  streak_last_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Linked wallets (many wallets per user, one user per wallet)
CREATE TABLE user_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES akiba_users(id) ON DELETE CASCADE,
  ecosystem       TEXT NOT NULL,           -- 'minipay' | 'base' | 'celo' | 'evm'
  wallet_address  TEXT NOT NULL,
  is_primary      BOOLEAN DEFAULT false,
  linked_at       TIMESTAMPTZ DEFAULT now(),
  last_verified   TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',      -- wallet age, activity signals
  UNIQUE(ecosystem, wallet_address)        -- one wallet address per ecosystem globally
);

-- User interests
CREATE TABLE user_interests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES akiba_users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,   -- 'games' | 'vouchers' | 'raffles' | 'defi' | 'quests' | 'leaderboards'
  weight       FLOAT DEFAULT 1.0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Reward preferences
CREATE TABLE user_reward_preferences (
  user_id              UUID PRIMARY KEY REFERENCES akiba_users(id) ON DELETE CASCADE,
  notify_games         BOOLEAN DEFAULT true,
  notify_vouchers      BOOLEAN DEFAULT true,
  notify_raffles       BOOLEAN DEFAULT true,
  notify_minipay       BOOLEAN DEFAULT true,
  notify_base          BOOLEAN DEFAULT true,
  notify_merchants     BOOLEAN DEFAULT true,
  notify_big_only      BOOLEAN DEFAULT false,   -- only notify if reward_value >= threshold
  notify_threshold     INT DEFAULT 500,          -- AkibaMiles value threshold
  push_enabled         BOOLEAN DEFAULT false,
  email_enabled        BOOLEAN DEFAULT true,
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 Campaigns & Offers

```sql
-- Partners / projects / merchants
CREATE TABLE partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  logo_url        TEXT,
  description     TEXT,
  website_url     TEXT,
  partner_type    TEXT NOT NULL,  -- 'project' | 'merchant' | 'game' | 'protocol'
  ecosystem       TEXT[],         -- ['minipay', 'base', 'celo', 'merchant']
  is_verified     BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Campaign (partner-defined or Akiba-internal)
CREATE TABLE campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id           UUID REFERENCES partners(id),
  title                TEXT NOT NULL,
  description          TEXT,
  campaign_type        TEXT NOT NULL,
    -- 'game_activation' | 'voucher' | 'wallet_action' | 'project_quest'
    -- 'raffle_gated' | 'referral' | 'streak' | 'hold_balance'
  ecosystem            TEXT NOT NULL,
    -- 'akiba' | 'minipay' | 'base' | 'merchant' | 'partner'
  target_interests     TEXT[],            -- matches user_interests.category
  target_ecosystems    TEXT[],            -- which wallet ecosystems are eligible
  eligibility_rules    JSONB DEFAULT '{}',
    -- e.g. { "min_wallet_age_days": 30, "min_balance_usdt": 10 }
  reward_type          TEXT NOT NULL,
    -- 'akiba_miles' | 'usdt' | 'voucher' | 'raffle_ticket' | 'discount' | 'game_credit'
  reward_value         NUMERIC,           -- AkibaMiles per action or USDT pool
  reward_pool          NUMERIC,           -- total budget
  reward_spent         NUMERIC DEFAULT 0,
  reward_per_user_max  INT,               -- max reward per unique user
  required_action      TEXT NOT NULL,     -- human-readable action description
  verification_method  TEXT NOT NULL,
    -- 'webhook' | 'onchain' | 'manual' | 'api_poll' | 'social'
  verification_config  JSONB DEFAULT '{}',
    -- { "webhook_secret": "...", "contract_address": "...", "abi_event": "..." }
  cta_label            TEXT DEFAULT 'Get Started',
  cta_url              TEXT,
  partner_priority     INT DEFAULT 0,     -- boosts scoring (paid placement later)
  status               TEXT DEFAULT 'draft',
    -- 'draft' | 'scheduled' | 'live' | 'paused' | 'completed' | 'cancelled'
  featured             BOOLEAN DEFAULT false,
  start_date           TIMESTAMPTZ,
  end_date             TIMESTAMPTZ,
  daily_limit          INT,               -- max verifications per day globally
  per_user_daily_limit INT DEFAULT 1,
  tags                 TEXT[],
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Offer Cards (generated from campaigns, one per campaign for now; expandable)
CREATE TABLE offer_cards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  offer_type           TEXT NOT NULL,
    -- 'campaign' | 'voucher' | 'game' | 'raffle' | 'quest' | 'promo' | 'merchant_offer'
  title                TEXT NOT NULL,
  subtitle             TEXT,
  image_url            TEXT,
  category             TEXT,
    -- 'games' | 'vouchers' | 'raffles' | 'quests' | 'defi' | 'merchants'
  ecosystem            TEXT,
  reward_type          TEXT,
  reward_value         NUMERIC,
  reward_display       TEXT,              -- "10 AkibaMiles per play"
  eligibility_summary  TEXT,             -- "Hold $10 USDT in MiniPay wallet"
  start_date           TIMESTAMPTZ,
  end_date             TIMESTAMPTZ,
  status               TEXT DEFAULT 'live',
    -- 'live' | 'starting_soon' | 'ending_soon' | 'completed' | 'locked'
  cta_label            TEXT,
  cta_url              TEXT,
  tags                 TEXT[],
  sort_weight          FLOAT DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

### 5.3 Personalization & Recommendations

```sql
-- Scored offer recommendations per user (refreshed by scoring engine)
CREATE TABLE user_offer_recommendations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES akiba_users(id) ON DELETE CASCADE,
  offer_id         UUID NOT NULL REFERENCES offer_cards(id) ON DELETE CASCADE,
  score            FLOAT NOT NULL,
  score_breakdown  JSONB DEFAULT '{}',
    -- { "eligibility": 30, "interest": 25, "ecosystem": 20, "urgency": 10, "value": 15 }
  personalized_reason TEXT,              -- "Matches your Games interest + Base wallet"
  eligibility_status  TEXT DEFAULT 'eligible',
    -- 'eligible' | 'connect_wallet' | 'not_eligible' | 'completed' | 'almost_eligible'
  is_seen          BOOLEAN DEFAULT false,
  is_dismissed     BOOLEAN DEFAULT false,
  computed_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, offer_id)
);
```

### 5.4 Rewards & Verifications

```sql
-- Verification events (each verified action)
CREATE TABLE verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES akiba_users(id),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id),
  action_ref        TEXT,                 -- external reference (game session ID, tx hash)
  verification_method TEXT NOT NULL,
  raw_payload       JSONB,               -- raw webhook/on-chain payload
  status            TEXT DEFAULT 'pending',
    -- 'pending' | 'verified' | 'rejected' | 'duplicate' | 'fraud_flagged'
  verified_at       TIMESTAMPTZ,
  fraud_signals     JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Reward transactions (ledger)
CREATE TABLE reward_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES akiba_users(id),
  campaign_id     UUID REFERENCES campaigns(id),
  verification_id UUID REFERENCES verifications(id),
  transaction_type TEXT NOT NULL,
    -- 'earn' | 'spend' | 'raffle_entry' | 'voucher_redeem' | 'bonus' | 'referral'
  reward_type     TEXT NOT NULL,
  amount          NUMERIC NOT NULL,      -- AkibaMiles, USDT, etc.
  balance_before  BIGINT,
  balance_after   BIGINT,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Vouchers
CREATE TABLE vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES campaigns(id),
  partner_id      UUID REFERENCES partners(id),
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT,  -- 'food' | 'airtime' | 'shopping' | 'entertainment'
  miles_cost      INT NOT NULL,
  monetary_value  NUMERIC,
  code            TEXT,                  -- or generated per redemption
  terms           TEXT,
  expiry_date     TIMESTAMPTZ,
  total_supply    INT,
  redeemed_count  INT DEFAULT 0,
  image_url       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- User voucher redemptions
CREATE TABLE user_voucher_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES akiba_users(id),
  voucher_id      UUID NOT NULL REFERENCES vouchers(id),
  redemption_code TEXT,
  status          TEXT DEFAULT 'active',  -- 'active' | 'used' | 'expired'
  redeemed_at     TIMESTAMPTZ DEFAULT now(),
  used_at         TIMESTAMPTZ
);

-- Raffles
CREATE TABLE raffles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id),
  title           TEXT NOT NULL,
  prize_description TEXT,
  prize_value     NUMERIC,
  prize_currency  TEXT DEFAULT 'USDT',
  entry_cost_miles INT DEFAULT 0,        -- 0 = free entry (earned via campaign)
  max_entries_per_user INT DEFAULT 1,
  total_entries   INT DEFAULT 0,
  winner_count    INT DEFAULT 1,
  draw_date       TIMESTAMPTZ,
  status          TEXT DEFAULT 'open',   -- 'open' | 'drawing' | 'closed' | 'cancelled'
  is_gated        BOOLEAN DEFAULT false, -- true = requires campaign completion
  gate_campaign_id UUID REFERENCES campaigns(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Raffle entries
CREATE TABLE raffle_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id   UUID NOT NULL REFERENCES raffles(id),
  user_id     UUID NOT NULL REFERENCES akiba_users(id),
  entry_count INT DEFAULT 1,
  source      TEXT,   -- 'campaign_unlock' | 'miles_purchase' | 'free'
  entered_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.5 Notifications

```sql
-- In-app notification records
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES akiba_users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
    -- 'new_campaign' | 'voucher_affordable' | 'almost_eligible' | 'ending_soon'
    -- 'reward_earned' | 'streak_reminder' | 'raffle_winner' | 'partner_launch'
  title           TEXT NOT NULL,
  body            TEXT,
  offer_id        UUID REFERENCES offer_cards(id),
  campaign_id     UUID REFERENCES campaigns(id),
  deep_link       TEXT,         -- e.g. 'akibahub://offer/offer_abc123'
  is_read         BOOLEAN DEFAULT false,
  channel         TEXT[],       -- ['push', 'email', 'in_app']
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Expo push tokens (one per device; user may have multiple devices)
CREATE TABLE user_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES akiba_users(id) ON DELETE CASCADE,
  expo_token  TEXT NOT NULL UNIQUE,   -- 'ExponentPushToken[...]'
  platform    TEXT NOT NULL,          -- 'ios' | 'android'
  device_id   TEXT,                   -- for deduplication
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_used   TIMESTAMPTZ DEFAULT now()
);
```

### 5.6 Analytics

```sql
CREATE TABLE campaign_analytics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  impressions      INT DEFAULT 0,     -- offer card views
  clicks           INT DEFAULT 0,     -- CTA taps
  starts           INT DEFAULT 0,     -- action initiated
  completions      INT DEFAULT 0,     -- verified completions
  rewards_issued   NUMERIC DEFAULT 0,
  unique_users     INT DEFAULT 0,
  UNIQUE(campaign_id, date)
);

CREATE TABLE offer_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES akiba_users(id),
  offer_id    UUID NOT NULL REFERENCES offer_cards(id),
  event       TEXT NOT NULL,   -- 'view' | 'click' | 'dismiss' | 'complete'
  context     TEXT,            -- 'for_you' | 'earn' | 'explore' | 'hub_page'
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Recommendation Scoring Logic

### 6.1 Scoring Formula (V1 — Rules-Based)

```
Offer Score (0–100) = 
  eligibility_score      (0–30)
  + interest_score       (0–25)
  + ecosystem_score      (0–20)
  + urgency_score        (0–10)
  + value_score          (0–10)
  + partner_priority     (0–5)
  - friction_penalty     (0–15)
  - risk_penalty         (0–10)
```

### 6.2 Factor Definitions

**eligibility_score (0–30)**
- 30: User fully eligible (wallet connected, all criteria met)
- 20: Almost eligible (one criterion missing — e.g., need 3 more miles)
- 10: Can become eligible (e.g., connect wallet to unlock)
- 0: Not eligible (wrong ecosystem, excluded)

**interest_score (0–25)**
- 25: Exact interest match (user selected 'games', offer is category 'games')
- 15: Adjacent interest match (user likes 'raffles', offer is 'raffle_gated')
- 5: Generic match (offer tagged with user's secondary interest)
- 0: No interest match

**ecosystem_score (0–20)**
- 20: User has connected wallet for this ecosystem AND has activity
- 12: User has connected wallet but no prior activity
- 5: Offer is from an ecosystem the user hasn't connected yet (show as "connect to unlock")
- 0: Offer requires ecosystem user explicitly declined

**urgency_score (0–10)**
- 10: Ending within 24 hours
- 7: Ending within 72 hours
- 4: Ending within 7 days
- 2: Starting soon (preview value)
- 0: No urgency signal

**value_score (0–10)**
- Score proportional to reward_value relative to average offer value
- Capped at 10 to prevent high-value offers dominating regardless of fit

**partner_priority (0–5)**
- Set by Akiba admin per campaign
- 5: Featured/sponsored campaign
- 0: Standard campaign

**friction_penalty (0–15)**
- -0: CTA opens in-app (no redirect)
- -5: CTA deeplinks to known mini-app
- -10: CTA goes to external partner site (increased drop-off)
- -15: Requires social action + external verification

**risk_penalty (0–10)**
- -0: No fraud signals
- -5: New campaign, no completion data yet (mild uncertainty)
- -10: User has suspicious claim patterns on this campaign type

### 6.3 Scoring Thresholds

```
Score ≥ 70: Show in "Best reward today" (hero slot)
Score 50–69: Show in primary feed sections (For You top fold)
Score 30–49: Show in secondary sections (For You scroll)
Score 10–29: Available in Explore / category tabs, not in For You
Score < 10: Hidden (not eligible, not relevant)
```

### 6.4 Feed Section Assignment

After scoring all offers for a user, assign to sections by rules:

```typescript
function assignSection(offer: ScoredOffer, user: AkibaUser): FeedSection {
  if (offer.score >= 70 && offer.eligibility_status === 'eligible') 
    return 'best_reward_today';
  
  if (offer.offer_type === 'game' && offer.ecosystem === 'base') 
    return 'new_on_base';
  
  if (offer.ecosystem === 'minipay') 
    return 'minipay_rewards';
  
  if (isEndingSoon(offer) && offer.eligibility_status === 'eligible')
    return 'ending_soon';
  
  if (offer.offer_type === 'voucher' && userCanAfford(offer, user))
    return 'vouchers_in_reach';
  
  if (offer.offer_type === 'game' || offer.offer_type === 'raffle')
    return 'play_and_earn';
  
  if (isNewCampaign(offer))
    return 'quick_earns';
  
  return 'recommended_for_you';
}
```

### 6.5 Scoring Refresh Schedule

- **On user open:** Recompute scores for top 50 offers if cache is stale (>30 min)
- **On campaign status change:** Recompute affected users' scores
- **On user wallet connect:** Recompute all offers for that user
- **On user interest change:** Full recompute for that user
- **Background job:** Nightly full recompute for all active users

### 6.6 AI Layer (Post-MVP)

After V1 is stable:
- Replace static `personalized_reason` text with LLM-generated one-liners
- Add conversational "What can I earn today?" interface
- Use completion/click data to tune scoring weights per cohort
- Partner-facing: "How should I structure this campaign for my target users?"

---

## 7. Notification Logic

### 7.1 Push Notification Architecture (Native)

Because Hub App is a native app on Play Store / App Store, push notifications go through:

```
Supabase Edge Function
        │
        ▼
Expo Push Notification Service (EPNS)
        │
    ┌───┴───┐
    │       │
   FCM    APNs
    │       │
Android   iOS
device   device
```

On first app open after login, the app requests notification permission and registers the Expo push token:

```typescript
// In apps/hub-app — run on app launch after auth
import * as Notifications from 'expo-notifications';

async function registerPushToken(userId: string) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  // POST /api/users/push-token  { expo_token: token, platform: Platform.OS }
  await apiClient.registerPushToken(userId, token);
}
```

### 7.2 Notification Triggers

| Trigger | When | Channel | Preference Gate |
|---|---|---|---|
| New campaign matches interest | Campaign goes live + score ≥ 50 | Push (FCM/APNs) + email | notify_{category} |
| Voucher becomes affordable | User earns enough miles | Push + in-app | notify_vouchers |
| Almost eligible | Score 20–29 (one action away) | In-app only | none — low friction |
| Campaign ending soon | 24h before end_date | Push | Relevant category pref |
| Reward earned | Verification confirmed | Push + in-app | Always (non-dismissable) |
| Streak reminder | No app open in 20h (if streak active) | Push | none |
| Raffle winner | After draw | Push + email | Always |
| Partner launch | New partner + score ≥ 60 | Push + email | notify_big_only threshold |
| New reward waiting | Unclaimed verified reward | Push + in-app | Always |

### 7.3 Deep Linking from Push Notifications

Each push notification includes a `deep_link` that opens the correct screen when tapped:

```
akibahub://offer/{offer_id}       → Offer detail screen
akibahub://raffle/{raffle_id}     → Raffle screen
akibahub://voucher/{voucher_id}   → Voucher claim screen
akibahub://tabs/for-you           → For You tab
akibahub://tabs/play              → Play tab
```

Expo Router handles these via `expo-linking` scheme config in `app.json`:
```json
{
  "expo": {
    "scheme": "akibahub",
    "intentFilters": [
      { "action": "VIEW", "data": { "scheme": "akibahub" } }
    ]
  }
}
```

### 7.4 Anti-Spam Rules

```
MAX_PUSH_PER_DAY = 3 per user (configurable)
MAX_EMAIL_PER_WEEK = 5 per user
COOLDOWN_SAME_CAMPAIGN = 72h (don't re-notify same campaign)
PRIORITY_ORDER (when daily limit is reached, send highest priority first):
  1. Reward earned       (always send — bypass limit)
  2. Raffle winner       (always send — bypass limit)
  3. Streak at risk      (once per day max)
  4. Ending soon         (once, 24h before expiry)
  5. New campaign        (throttled to MAX_PUSH_PER_DAY)
```

### 7.5 Notification Dispatch Flow

```
Trigger event fires (e.g., new campaign published)
        │
        ▼
Supabase Edge Function: dispatch_notifications
        │
        ▼
Query: SELECT u.id, upt.expo_token
  FROM akiba_users u
  JOIN user_push_tokens upt ON upt.user_id = u.id
  JOIN user_offer_recommendations uor ON uor.user_id = u.id
  JOIN user_reward_preferences prefs ON prefs.user_id = u.id
  WHERE uor.score >= 50
    AND prefs.notify_{category} = true
    AND upt.is_active = true
    AND u.id NOT IN (
      SELECT user_id FROM notifications
      WHERE campaign_id = $campaign_id
      AND created_at > now() - interval '72 hours'
    )
    AND (
      SELECT COUNT(*) FROM notifications
      WHERE user_id = u.id
        AND 'push' = ANY(channel)
        AND created_at > now() - interval '24 hours'
    ) < 3
        │
        ▼
Batch expo_tokens into chunks of 100
        │
        ▼
POST https://exp.host/--/api/v2/push/send
  Body: [{ to, title, body, data: { deep_link } }]
        │
        ▼
For each user: INSERT INTO notifications (in_app record)
For email-enabled users: queue Resend email
        │
        ▼
Handle Expo receipt check (async, 15 min later):
  DeviceNotRegistered → set user_push_tokens.is_active = false
```

---

## 8. Partner Campaign Workflow

### 8.1 Campaign Lifecycle States

```
draft → scheduled → live → paused → completed
                 ↘ cancelled
```

### 8.2 Partner Onboarding (V1: Manual/Admin)

In V1, Akiba manually onboards partners. The Partner Platform UI is post-MVP.

V1 partner onboarding steps:
1. Akiba team adds partner to `partners` table
2. Partner briefs Akiba on campaign requirements (form or call)
3. Akiba admin creates campaign record with all fields
4. Partner supplies: logo, campaign assets, CTA URL, verification credentials (webhook secret or contract address)
5. Akiba tests verification end-to-end in staging
6. Campaign scheduled → published

### 8.3 Verification Methods — V1 Support

| Method | How it works | Latency |
|---|---|---|
| Webhook | Partner's system calls Akiba `/api/verify/webhook/{campaign_id}` with HMAC signature | Near real-time |
| On-chain listener | Akiba watches for on-chain event (Viem/ethers event filter) on Base or Celo | ~5–30s |
| Manual | Akiba admin manually marks user completion (small campaigns, events) | Manual |
| API poll | Akiba polls partner API periodically to check user action status | Periodic (1h intervals) |

### 8.4 Webhook Verification Schema

```typescript
// POST /api/verify/webhook/{campaign_id}
// Header: X-Akiba-Signature: HMAC-SHA256(secret, body)
{
  "user_identifier": "0xabc..." | "user@email.com",  // wallet or email
  "action_ref": "session_12345",                      // idempotency key
  "action_type": "game_play" | "quest_complete" | ...,
  "metadata": {}
}

// Akiba response
{
  "verification_id": "uuid",
  "status": "verified" | "duplicate" | "rejected",
  "reward_issued": true,
  "message": "10 AkibaMiles credited"
}
```

### 8.5 Anti-Fraud Checks (V1)

Each verification runs these checks before issuing reward:

```
1. Campaign is live and within start/end dates
2. Campaign has remaining budget
3. user_id is valid and not banned
4. action_ref has not been used before (idempotency — prevents duplicate claims)
5. Per-user daily limit not exceeded
6. Per-user total limit not exceeded
7. Wallet age check (if configured): wallet must be > N days old
8. Device/session rate limit: max 10 verifications per device per hour
9. Wallet activity check: wallet must have had at least 1 prior transaction (not brand new burner)
```

### 8.6 Partner Analytics (V1)

Partners receive a campaign analytics view (initially a Supabase dashboard view or CSV export):

```sql
-- Partner Campaign Summary View
SELECT
  c.title,
  ca.date,
  ca.impressions,
  ca.clicks,
  ca.completions,
  ca.rewards_issued,
  ca.unique_users,
  ROUND(ca.completions::float / NULLIF(ca.clicks, 0) * 100, 1) as conversion_rate
FROM campaign_analytics ca
JOIN campaigns c ON c.id = ca.campaign_id
WHERE c.partner_id = $partner_id
ORDER BY ca.date DESC;
```

---

## 9. MVP Scope — First 4 Weeks

> **Build order note:** The native app (Expo) takes longer to get into users' hands than a web app. Get the Expo project set up and on TestFlight / Play Store internal track in Week 1, even with placeholder screens, so store review is not a blocker at the end of Week 4.

### Week 1: Foundation + App Store Track

**Goal:** Core infrastructure running. Expo app bootstrapped and submitted to internal test tracks.

Deliverables:
- Supabase project setup: auth (OTP), schema migrations for all core tables
- Expo app scaffolded: Expo Router, bottom tabs, placeholder screens for all 6 tabs
- EAS Build configured: `eas.json` with development / preview / production profiles
- EAS Update configured: OTA channel for production
- App submitted to **Play Store internal testing** track and **TestFlight** (even as a placeholder build — gets ahead of review queues)
- OTP login working end-to-end in the native app (Supabase Auth + `expo-secure-store`)
- Push notification permission flow implemented (`expo-notifications` + token registration)
- Hub Page: static Next.js page with seeded offer cards (5–10 offers)
- API routes: `GET /users/me`, `POST /users/interests`, `POST /users/wallets`, `POST /users/push-token`

Acceptance: A test user can install the app via TestFlight/internal track, log in with OTP, grant push permission, and see seeded offer cards on the For You screen.

### Week 2: Personalization & Earn Tab

**Goal:** Recommendations work, first real campaigns in the system, push notifications tested.

Deliverables:
- Recommendation scoring engine (rules-based TypeScript, in `packages/scoring`)
- `user_offer_recommendations` refresh on login + interest change
- For You SectionList with personalized_reason rendered per card
- Earn tab with first 3 live campaigns (MiniPay USDT hold, Pretium quest placeholder, signup bonus)
- Campaign admin tool (Supabase Table Editor + minimal Next.js admin page)
- Webhook verification endpoint (HMAC validation)
- **Push notification sent to test device** on reward earned (Expo EPNS → FCM/APNs)
- Deep link from push notification → correct screen working on both iOS and Android

Acceptance: Two test users with different interests see different For You feeds. Tapping a push notification opens the correct offer screen.

### Week 3: Play & Redeem

**Goal:** Raffles, games, vouchers working end-to-end. Miles ledger accurate.

Deliverables:
- Play tab: raffle cards, game cards (external deeplink launch), gated raffle unlock flow
- Raffle entry: user spends AkibaMiles → `raffle_entries` → bottom sheet confirmation
- Redeem tab: voucher cards, miles check, claim → redemption code screen
- AkibaMiles ledger (`reward_transactions`): earn and spend both posting correctly
- Profile tab: balance, wallets, interests, vouchers, raffle entries
- In-app notification centre (bottom sheet, mark as read, badge count on bell icon)
- **EAS Update:** push a JS-only hotfix to production channel to verify OTA works

Acceptance: User can enter a raffle, claim a voucher, and see their balance update correctly. OTA update delivered without store re-submission.

### Week 4: Explore, Polish & Store Release

**Goal:** Stable, store-ready build. One live partner campaign end-to-end.

Deliverables:
- Explore tab: all campaigns, filterable by ecosystem + category
- Hub Page: fully styled, pulls real campaign data from API, App Store + Play Store badges
- Campaign analytics: `campaign_analytics` table populated, CSV export for partners
- Notification system: push + email (Resend) for all triggers in §7.2
- End-to-end: Partner campaign → user sees in For You → completes → verified → rewarded → analytics updated
- **Production EAS Build** submitted to Play Store production and App Store review
- Performance: For You SectionList renders in <1.5s on a mid-range Android device
- Error handling: failed verifications, expired campaigns, empty states, network offline

Acceptance: App approved and live on both stores. One real partner campaign runs E2E with at least 10 real users. Hub Page publicly accessible with correct store download links.

---

## 10. What to Avoid Overbuilding

**Do not build in the first 4 weeks:**

- ML/AI recommendation engine. Rules-based scoring is sufficient and debuggable. Revisit after 10K+ users with click data.
- Partner self-serve portal. Manual campaign creation by Akiba admin is fine for the first 10 partners.
- On-chain verification for all campaigns. Start with webhook only. On-chain listeners add complexity; add them for specific Base campaigns when needed.
- Social login (Twitter/X, Discord). Out of scope for MVP.
- Referral streak complex mechanics. Simple referral code is fine. Tiered streak rewards are post-MVP.
- Real-time leaderboard with WebSockets. Static leaderboard updated every 15 minutes is sufficient.
- Voucher code generation at scale. Start with static codes from partners; per-user dynamic generation is post-MVP.
- API/SDK for partners. Not needed until you have 5+ partners and a repeatable integration pattern.
- Campaign A/B testing framework. Post-MVP analytics feature.
- Advanced fraud ML model. Simple rule-based checks (idempotency, rate limits, wallet age) are sufficient for V1.
- Custom native modules or bare React Native workflow. Stay in Expo managed workflow for the entire MVP. Only eject to bare if you hit a hard native library limitation, which is unlikely at MVP scale.
- In-app browser (WebView) for partner campaigns. Open external links with `Linking.openURL()` or the system browser. Building a full in-app browser adds complexity and App Store review risk.
- Biometric auth. OTP is sufficient for MVP. Biometric (Face ID / fingerprint) can be layered on later via `expo-local-authentication`.
- Background sync / background fetch. The scoring engine runs server-side. No need for background tasks on the device in V1.

---

## 11. App Store & Play Store Considerations

### 11.1 App Store Review Risk Areas

The following features have known App Store / Play Store sensitivities and should be framed carefully:

| Feature | Risk | Mitigation |
|---|---|---|
| Raffles / prize draws | Apple may classify as gambling | Frame as "reward draws" not "gambling". Always provide a free entry method. No real-money wagering. Include T&Cs. |
| Crypto wallet linking | Apple requires disclosure of financial features | State clearly in App Store description that the app links wallets but does not conduct transactions within the app. |
| USDT rewards | May trigger financial app review | Describe as "reward campaigns managed by partners" not "trading" or "investment". |
| Push notifications for campaigns | Excessive marketing push can get flagged in reviews | Default to opt-in; respect user preferences; include unsubscribe in every email. |
| External payment / wallet CTAs | Apple 3.1.1 — no directing users to external purchase flows | Campaign CTAs that involve any payment must go through the system browser, not a WebView, and must not be framed as in-app purchases. |

### 11.2 Required App Store Metadata

Before submission, prepare:
- App name: "Akiba Hub" (or "AkibaMiles — Earn & Redeem")
- Privacy policy URL (required — must cover wallet data, notification data, OTP)
- Terms of service URL (required)
- App category: Lifestyle or Finance
- Age rating: 17+ (due to potential monetary prizes — conservative choice)
- In-app purchases: None declared (rewards are external, not IAP)
- Permissions required: Push Notifications, (optionally) Camera for QR voucher scan

### 11.3 EAS Build + Release Workflow

```
Development
  eas build --profile development
  → Expo Go compatible dev client
  → Used by engineers daily

Preview (Internal Testing)
  eas build --profile preview
  → Play Store internal testing track
  → TestFlight internal testers
  → Used for QA and stakeholder demos

Production
  eas build --profile production
  → Play Store production rollout (staged: 10% → 50% → 100%)
  → App Store review submission
  → Used for real user releases

OTA (between store releases)
  eas update --channel production
  → Pushes JS/asset changes only
  → No store review needed
  → Use for: campaign UI changes, scoring tweaks, copy fixes
  → Cannot use for: new native modules, app.json permission changes
```

### 11.4 Minimum Viable App Store Info

The Hub Page should include App Store and Google Play badges with the correct store links from Day 1. Even before the app is fully live, a "coming soon" landing page on the Hub Page builds the store listing authority and lets early users wishlist/follow.

---

## 12. Open Questions & Assumptions

### Identity & Wallets

- **Q:** Should a MiniPay wallet linked to User A be blocked from linking to User B? **Assumption:** Yes — one wallet address per Akiba account globally. Enforce at DB level (UNIQUE on wallet_address per ecosystem).
- **Q:** What happens if a user loses access to their email and has no phone linked? **Assumption:** Add recovery flow post-MVP (link both email and phone during onboarding).
- **Q:** Do we support custodial wallets (e.g., MiniPay) and non-custodial wallets (MetaMask) with the same flow? **Assumption:** Yes — wallet_address is stored regardless of wallet type. Verification is address-based.

### Campaigns & Verification

- **Q:** Who bears risk if a partner does not pay out after reward is issued? **Assumption:** Partner pre-funds campaigns (budget deposited to Akiba before launch). Akiba does not issue rewards beyond `reward_pool`.
- **Q:** What if a webhook fires for a user who is not in Akiba's system yet? **Assumption:** Create a pending verification record. If user signs up within 7 days and links the relevant wallet, credit the reward.
- **Q:** How granular is campaign targeting? Can partners target specific wallet addresses? **Assumption:** Not in V1. Targeting is by ecosystem, interests, and basic eligibility rules. Address-level allowlists are a V2 feature.

### AkibaMiles

- **Q:** Is AkibaMiles a fully on-chain token or an off-chain points system? **Assumption:** Off-chain points stored in Supabase for V1. On-chain token bridge is a future upgrade. This keeps the system fast and avoids gas complexity.
- **Q:** Do AkibaMiles expire? **Assumption:** No expiry in V1. Revisit if abuse (hoarders) becomes a problem.

### Regulatory & Compliance

- **Q:** Do raffles need to be structured as sweepstakes (free entry option) in certain jurisdictions? **Assumption:** Yes. Always provide a no-purchase entry option for any raffle that involves monetary prizes. This needs legal review before launch.
- **Q:** Does USDT prize distribution require financial licensing in target markets? **Assumption:** Needs legal review per market. Tag as "reward pool" not "prize money" for now.

### Technical

- **Q:** Where does the monorepo currently live? Is it on Vercel? **Assumption:** Next.js apps deploy to Vercel. Supabase Edge Functions for webhooks/notifications.
- **Q:** Is `packages/react-app` an existing design system with tokens/components? **Assumption:** Yes — the scoring and routing should build on top of those primitives rather than creating a competing component library.

---

## 13. Milestones & Acceptance Criteria

### Milestone 1: Auth & Profile — End of Week 1

| Criterion | Pass Definition |
|---|---|
| OTP login works (native) | User on physical iOS + Android device enters email/phone → receives OTP → logs in successfully in the native app |
| Push token registered | After login, push permission granted → `user_push_tokens` record created with valid Expo token |
| App on internal tracks | Build installed via TestFlight on iOS and Play Store internal testing on Android |
| Profile created | New user record in `akiba_users` with generated `referral_code` |
| Interest picker | User selects ≥1 interest → saved to `user_interests` |
| Wallet connect | User links MiniPay or Base wallet → saved to `user_wallets` with UNIQUE constraint enforced |
| Offer cards visible | Hub Page renders ≥5 seeded offers; Hub App SectionList renders them in skeleton For You screen |

### Milestone 2: Recommendation Engine — End of Week 2

| Criterion | Pass Definition |
|---|---|
| Scoring produces different results | User A (Base + Games) and User B (MiniPay + Vouchers) see different For You feed order |
| Personalized reason displayed | Each For You card shows `personalized_reason` string matching their profile |
| Campaign webhook verified | Test webhook fires → verification record created → AkibaMiles credited → ledger updated |
| Admin can publish campaign | Campaign created in admin → status set to 'live' → appears in Hub App |

### Milestone 3: Play & Redeem — End of Week 3

| Criterion | Pass Definition |
|---|---|
| Raffle entry works | User with enough miles enters raffle → `raffle_entries` record → miles debited |
| Voucher claim works | User redeems voucher → `user_voucher_redemptions` record → redemption code shown |
| Miles ledger accurate | Every earn and spend creates a `reward_transactions` record; balance reconciles |
| Profile complete | User can view balance, wallets, interests, raffle entries, vouchers in Profile tab |
| In-app notification | Reward earned event → notification created → appears in bell |

### Milestone 4: End-to-End Partner Campaign — End of Week 4

| Criterion | Pass Definition |
|---|---|
| Hub Page live | Publicly accessible URL, renders real campaign data, no login required |
| Partner campaign E2E | Partner sends webhook → user earns miles → campaign_analytics updated → partner can see CSV |
| For You loads in <2s | P95 load time for recommendation feed under 2 seconds |
| Email notification sent | User earns reward → email sent via Resend within 60 seconds |
| No duplicate rewards | Same `action_ref` sent twice → second webhook returns "duplicate" → no double credit |
| Empty states handled | User with no relevant offers sees onboarding prompt, not blank screen |

---

## Appendix A: Example Offer Card JSON

```json
{
  "id": "offer_abc123",
  "campaign_id": "camp_xyz456",
  "offer_type": "raffle_gated",
  "title": "June MiniPay $50 USDT Daily Draw",
  "subtitle": "10 winners every day",
  "image_url": "https://cdn.akibamiles.com/campaigns/minipay-june.png",
  "category": "raffles",
  "ecosystem": "minipay",
  "reward_type": "usdt",
  "reward_value": 50,
  "reward_display": "$50 USDT reward pool — 10 winners daily",
  "eligibility_summary": "Hold $10 USDT in your MiniPay wallet",
  "start_date": "2026-06-01T00:00:00Z",
  "end_date": "2026-06-30T23:59:59Z",
  "status": "live",
  "cta_label": "Open the app to check eligibility",
  "cta_url": "minipay://akiba/campaign/camp_xyz456",
  "tags": ["minipay", "usdt", "daily", "raffle"],
  "personalized_reason": "Matches your MiniPay wallet + Raffles interest",
  "eligibility_status": "eligible"
}
```

## Appendix B: Offer Card Visual States

```
┌─────────────────────────────────────────┐
│  [ecosystem badge]   [reward tag]        │
│                                          │
│  Campaign Title                          │
│  Partner name                            │
│                                          │
│  Reward: 10 AkibaMiles per play          │
│  Action: Play CrackPot on Base           │
│                                          │
│  ⏱ Ends in 2 days                       │
│  ✦ Matches your Games interest           │
│                                          │
│  [    Play CrackPot on Base    ]  →      │
└─────────────────────────────────────────┘

Eligibility chip states:
  🟢 Eligible — show CTA
  🔵 Connect wallet — show "Connect Base wallet to unlock"
  🔒 Locked — show "Complete 2 more plays to unlock raffle"
  ✅ Completed — show "Done · 10 AkibaMiles earned"
  ⚪ Not eligible — show greyed card, no CTA
```

---

*Document prepared for AkibaMiles engineering and design handoff. All schemas are proposals — review with DBA and adjust column types, indexes, and RLS policies before production migration.*
