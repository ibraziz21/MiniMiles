/* ------------------------------------------------------------------------
   /api/quests/daily_transfer/route.ts       (timeout-safe, verbose version)
   ------------------------------------------------------------------------ */

   import { createClient } from '@supabase/supabase-js';
   import {
     createWalletClient,
     createPublicClient,
     http,
     parseAbiItem,
     parseUnits,
     Hex,
     Log,
   } from 'viem';
   import { privateKeyToAccount } from 'viem/accounts';
   import { celo } from 'viem/chains';
   import { NextResponse } from 'next/server';
   import MiniPointsAbi from '@/contexts/minimiles.json';
   
   /* ─── env ---------------------------------------------------------------- */
   
   const {
     SUPABASE_URL = '',
     SUPABASE_SERVICE_KEY = '',
     PRIVATE_KEY = '',
     MINIPOINTS_ADDRESS = '',
     CUSD_ADDRESS = '',
     USDT_ADDRESS = '',
   } = process.env;
   
   if (
     !SUPABASE_URL ||
     !SUPABASE_SERVICE_KEY ||
     !PRIVATE_KEY ||
     !MINIPOINTS_ADDRESS ||
     !CUSD_ADDRESS
   ) {
     console.error('[DAILY-CUSD] Missing environment variables.');
     throw new Error('Missing config for daily cUSD quest.');
   }
   
   /* ─── clients ------------------------------------------------------------ */
   
   const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
   const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
   const publicClient = createPublicClient({
     chain: celo,
     /* 15-s timeout so each slice fails fast instead of hanging 45 s */
     transport: http('https://forno.celo.org', { timeout: 15_000 }), // ←★
   });
   const walletClient = createWalletClient({ account, chain: celo, transport: http() });
   
   /* ─── quest handler ------------------------------------------------------ */
   
   export async function POST(req: Request) {
     try {
       const { userAddress, questId } = await req.json();
       const addresses = [USDT_ADDRESS, CUSD_ADDRESS];
   
       /* 1 ▸ already claimed today? */
       const today = new Date().toISOString().slice(0, 10);
       const { data: claimed } = await supabase
         .from('daily_engagements')
         .select('*')
         .eq('user_address', userAddress)
         .eq('quest_id', questId)
         .eq('claimed_at', today)
         .maybeSingle();
   
       if (claimed) {
         return NextResponse.json({ success: false, message: 'Already claimed today' });
       }
   
       /* 2 ▸ on-chain spend check (any token) */
       let spent = false;
       for (const token of addresses) {
         if (await hasUserSpentAtLeast1DollarIn24Hrs(userAddress, token as Hex)) {
           spent = true;
           break;
         }
       }
       if (!spent) {
         return NextResponse.json({
           success: false,
           message: 'No on-chain transfer ≥ $1 found in the last 24 h',
         });
       }
   
       /* 3 ▸ mint points */
       const { request } = await publicClient.simulateContract({
         address: MINIPOINTS_ADDRESS as Hex,
         abi: MiniPointsAbi.abi,
         functionName: 'mint',
         args: [userAddress, parseUnits('15', 18)],
         account,
       });
       const txHash = await walletClient.writeContract(request);
   
       /* 4 ▸ store claim */
       await supabase.from('daily_engagements').insert({
         user_address: userAddress,
         quest_id: questId,
         claimed_at: today,
         points_awarded: 15,
       });
   
       return NextResponse.json({ success: true, txHash });
     } catch (err) {
       console.error('[DAILY-CUSD] Error:', err);
       return NextResponse.json({ success: false, message: 'Daily cUSD claim failed' });
     }
   }
   
   /* ------------------------------------------------------------------------
      helpers
      ------------------------------------------------------------------------ */
   
   /**
    * Did `userAddress` send >= $1 (token) in the last 24 h?
    * ≥ $1 == 1 × 10^decimals  (use parseUnits('1', decimals))
    */
   async function hasUserSpentAtLeast1DollarIn24Hrs(
     userAddress: string,
     tokenAddress: Hex,
   ): Promise<boolean> {
     /* chain data ---------------------------------------------------------- */
     const latest = await publicClient.getBlockNumber();
     const blocksPer24h = 17_280n; // 5 s blocks on Celo Mainnet
     const startBlock = latest > blocksPer24h ? latest - blocksPer24h : 0n;
   
     /* slice params -------------------------------------------------------- */
     const slice = 3_000n; // ←★ good balance: 3 k × 200 logs ≃ 600 kB
     const TOKEN_DECIMALS: Record<string, number> = {
       [USDT_ADDRESS]: 6,
       [CUSD_ADDRESS]: 18,
     };
     const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
     const ONE_DOLLAR = parseUnits('1', decimals);
   
     const transferEvent = parseAbiItem(
       'event Transfer(address indexed from, address indexed to, uint256 value)',
     );
   
     /* iterate slices newest → oldest ------------------------------------- */
     for (let from = latest; from >= startBlock; from -= slice) {
       const to = from;
       const fromBlk = from > slice ? from - slice + 1n : 0n;
   
       console.debug(
         `[DAILY-CUSD] scanning ${tokenAddress} blocks ${fromBlk}-${to} (${Number(
           latest - fromBlk,
         )} processed so far)`,
       ); // ←★ logging
   
       let logs: Log[];
       try {
         logs = await publicClient.getLogs({
           address: tokenAddress,
           event: transferEvent,
           fromBlock: fromBlk,
           toBlock: to,
         });
       } catch (err) {
         console.warn('[DAILY-CUSD] slice RPC failed → retry smaller range', err);
         /* optional: retry once with half the slice */
         continue;
       }
   
       for (const log of logs) {
         const [fromAddr, /* toAddr */, value] = log.topics[0] as unknown as Hex[];
         if (
           fromAddr.toLowerCase() === userAddress.toLowerCase() &&
           BigInt(value) >= ONE_DOLLAR
         ) {
           const { timestamp } = await publicClient.getBlock({
             blockNumber: log.blockNumber!,
           });
           if (!timestamp) continue;
           const ageSec = Math.floor(Date.now() / 1_000) - Number(timestamp);
           if (ageSec <= 86_400) {
             console.debug('[DAILY-CUSD] matching transfer found:', {
               block: log.blockNumber,
               value: value.toString(),
             }); // ←★
             return true;
           }
         }
       }
     }
     console.debug('[DAILY-CUSD] no qualifying transfer in last 24 h'); // ←★
     return false;
   }
   