# React Framework + NextJS | Celo Composer

Celo Composer support React boilerplate template with TailwindCSS. This is a starter kit with no additional boilerplate code. It's a perfect starter kit to get your project started on Celo blockchain.

## Setup & Installation


### Set environment variables

Create a copy of `.env.template` and rename it to `.env`.

Supabase key split:

```bash
# Browser-safe
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_KILN_DAILY_HOLD_QUEST_ID=...

# Server-only
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
KILN_SHARE_TOKEN_ADDRESS=0xbaD4711D689329E315Be3E7C1C64CF652868C56c
KILN_SHARE_TOKEN_DECIMALS=6
KILN_DAILY_MIN_HOLD=10
KILN_DAILY_POINTS=30
```

Do not use `NEXT_PUBLIC_SUPABASE_SERVICE_KEY`. Service role keys must stay server-only.

### Run the Mint Queue SQL

Execute [minipoint_mint_queue.sql](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/react-app/sql/minipoint_mint_queue.sql) in your Supabase SQL editor before using queued quest minting. It creates:

- `minipoint_mint_jobs`
- `minipoint_mint_queue_locks`
- the RPC functions the API uses to claim, retry, complete, and lock mint jobs

You can also drain queued jobs manually via `POST /api/admin/drain-mint-queue` using `Authorization: Bearer $ADMIN_QUEUE_SECRET` or `?secret=$ADMIN_QUEUE_SECRET`.

#### Add Wallet Connect ID

Create a WalletConnect Cloud Project ID from [WalletConnect Cloud](https://cloud.walletconnect.com/)

Provide the WalletConnect Cloud Project ID in your `.env` file to use WalletConnect in your project. As shown in the `.env.example` file.

```typescript
NEXT_PUBLIC_WC_PROJECT_ID=YOUR_EXAMPLE_PROJECT_ID;
```

### Install dependencies

Install all the required dependencies to run the dApp.

Using **yarn**

```bash
yarn
```

or using **npm**

```bash
npm i
```

> React + Tailwind CSS Template does not have any dependency on hardhat.
> This starterkit does not include connection of Hardhat/Truffle with ReactJS. It's up to the user to integrate smart contract with ReactJS. This gives user more flexibility over the dApp.

- To start the dApp, run the following command.

```bash
yarn dev
```

or using **npm**

```bash
npm run dev
```

## Dependencies

### Default

- [Next.js](https://nextjs.org/) app framework
- [TailwindCSS](https://tailwindcss.com/) for UI

## Architecture

- `/pages` includes the main application components (specifically `layout.tsx` and `page.tsx`)
  - `layout.tsx` includes configuration
  - `page.tsx` is the main page of the application
- `/components` includes components that are rendered in `page.tsx`
- `/public` includes static files
