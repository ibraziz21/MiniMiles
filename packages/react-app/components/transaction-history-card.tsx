import dayjs from 'dayjs';
import { HistoryItem } from '@/helpers/txHistory';

interface Props { items: HistoryItem[]; }

export default function TransactionHistoryCard({ items }: Props) {
  if (!items.length) return (
    <p className="mx-4 mt-2 text-sm text-gray-500">No history yet.</p>
  );

  return (
    <div className="space-y-3 mx-4">
      {items.map(it => (
        <div key={it.id}
             className="p-3 flex justify-between border border-[#238D9D4D] font-sterling rounded-3xl bg-white">
          <div className="flex flex-col">
            <div className="flex gap-1 items-center">
              <h3 className="font-medium">
                {it.type === 'EARN'  && 'Earned MiniMiles'}
                {it.type === 'SPEND' && 'Spent MiniMiles'}
                {it.type === 'RAFFLE_ENTRY' && 'Raffle entry'}
                {it.type === 'RAFFLE_WIN'   && 'Raffle win'}
              </h3>
              <p className="text-gray-500 font-light">· {dayjs.unix(it.ts).format('DD/MM/YY')}</p>
            </div>
            <p className="text-gray-500 font-light">{it.note}</p>
          </div>
          {/* <button className="text-[#219653] bg-[#ADF4FF80] rounded-full px-3">View</button> */}
        </div>
      ))}
    </div>
  );
}
