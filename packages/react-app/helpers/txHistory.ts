/* --------------------------------------------------------------------------
   hooks/useMiniMilesHistory.ts
   Verbose-logging version – drop-in replacement
   -------------------------------------------------------------------------- */

   import { useQuery } from '@tanstack/react-query';
   import { gql, request } from 'graphql-request';
   import { useWeb3 } from '@/contexts/useWeb3';
   
   /* ------------------------------------------------------------------ CONFIG */
   
   const MINI_SUBGRAPH =
     'https://api.studio.thegraph.com/query/115307/akiba-miles/version/latest';
   const RAFFLE_SUBGRAPH =
     'https://api.studio.thegraph.com/query/115307/akiba-miles/version/latest';
   
   /* ------------------------------------------------------------------- TYPES */
   
   export type HistoryItem =
     | { id: string; ts: number; type: 'EARN';         amount: string; note: string }
     | { id: string; ts: number; type: 'SPEND';        amount: string; note: string }
     | { id: string; ts: number; type: 'RAFFLE_ENTRY'; roundId: string; note: string }
     | { id: string; ts: number; type: 'RAFFLE_WIN';   roundId: string;  note: string };
   
   type RawTransfer = {
     id: string;
     from: string;
     to: string;
     value: string;
     blockTimestamp: string;
   };
   
   type RawJoin = {
     id: string;
     roundId: string;
     blockTimestamp: string;
     // tickets?: string;            // uncomment if present in schema
   };
   
   type RawWin = {
     id: string;
     roundId: string;
     blockTimestamp: string;
   };
   
   /* ------------------------------------------------------------- GRAPHQL DOCS */
   
   const TRANSFERS = gql`
     query ($user: Bytes!) {
       in: transfers(
         where: { to: $user }
         orderBy: blockTimestamp
         orderDirection: desc
       ) {
         id
         from
         value
         blockTimestamp
       }
       out: transfers(
         where: { from: $user }
         orderBy: blockTimestamp
         orderDirection: desc
       ) {
         id
         to
         value
         blockTimestamp
       }
     }
   `;
   
   const JOINS = gql`
     query ($user: Bytes!) {
       joins: participantJoineds(
         where: { participant: $user }       # correct filter field
         orderBy: blockTimestamp
         orderDirection: desc
       ) {
         id
         roundId
         blockTimestamp
         # tickets                         # add back if available
       }
     }
   `;
   
   const WINS = gql`
     query ($user: Bytes!) {
       wins: winnerSelecteds(
         where: { winner: $user }
         orderBy: blockTimestamp
         orderDirection: desc
       ) {
         id
         roundId
         blockTimestamp
       }
     }
   `;
   
   /* ----------------------------------------------------------------- LOGGING */
   
   const stamp = () =>
     new Date().toISOString().split('T')[1].replace('Z', '');
   
   function log(step: string, msg: unknown, ...rest: unknown[]) {
     console.debug(`[history:${stamp()}] ${step}`, msg, ...rest);
   }
   
   /* -------------------------------------------------------------------- HOOK */
   
   export function useMiniMilesHistory() {
     const { address } = useWeb3();
     const user = address?.toLowerCase() ?? '';
   
     return useQuery<HistoryItem[]>({
       queryKey: ['history', user],
       enabled: !!user,
       queryFn: async (): Promise<HistoryItem[]> => {
         if (!user) return [];
   
         try {
           /* 1 ▸ token transfers ------------------------------------------- */
           log('request', 'TRANSFERS', { user });
   
           const { in: ins, out: outs } =
             await request<{ in: RawTransfer[]; out: RawTransfer[] }>(
               MINI_SUBGRAPH,
               TRANSFERS,
               { user }
             );
   
           log(
             'response',
             `TRANSFERS → in:${ins.length} out:${outs.length}`,
             { sampleIn: ins[0], sampleOut: outs[0] }
           );
   
           /* 2 ▸ raffle joins + wins (parallel) ---------------------------- */
           log('request', 'JOINS & WINS', { user });
   
           const [{ joins }, { wins }] = await Promise.all([
             request<{ joins: RawJoin[] }>(RAFFLE_SUBGRAPH, JOINS, { user }),
             request<{ wins: RawWin[] }>(RAFFLE_SUBGRAPH, WINS, { user }),
           ]);
   
           log(
             'response',
             `JOINS:${joins.length} WINS:${wins.length}`,
             { sampleJoin: joins[0], sampleWin: wins[0] }
           );
   
           /* 3 ▸ normalise -------------------------------------------------- */
           const earnItems: HistoryItem[] = ins.map(t => ({
             id: t.id,
             ts: +t.blockTimestamp,
             type: 'EARN' as const,
             amount: (+t.value / 1e18).toFixed(0),
             note: `You earned ${(+t.value / 1e18).toFixed(0)} MiniMiles`,
           }));
   
           const spendItems: HistoryItem[] = outs.map(t => ({
             id: t.id,
             ts: +t.blockTimestamp,
             type: 'SPEND' as const,
             amount: (+t.value / 1e18).toFixed(0),
             note: `You spent ${(+t.value / 1e18).toFixed(0)} MiniMiles`,
           }));
   
           const joinItems: HistoryItem[] = joins.map(j => ({
             id: j.id,
             ts: +j.blockTimestamp,
             type: 'RAFFLE_ENTRY' as const,
             roundId: j.roundId,
             note: `Entered raffle #${j.roundId}`,
           }));
   
           const winItems: HistoryItem[] = wins.map(w => ({
             id: w.id,
             ts: +w.blockTimestamp,
             type: 'RAFFLE_WIN' as const,
             roundId: w.roundId,
             note: `🎉 Won raffle #${w.roundId} `,
           }));
   
           /* 4 ▸ merge + newest-first ------------------------------------- */
           const merged = [
             ...earnItems,
             ...spendItems,
             ...joinItems,
             ...winItems,
           ].sort((a, b) => b.ts - a.ts);
   
           log('merge', `Total history items: ${merged.length}`);
   
           return merged;
         } catch (err) {
           console.error('[history] Subgraph query failed:', err);
           throw err; // let React Query set error state
         }
       },
     });
   }
   