import dayjs from 'dayjs';
import { HistoryItem } from '@/types/history';

interface Props {
  items: HistoryItem[];
}

export default function TransactionHistoryCard({ items }: Props) {
  if (!items.length) {
    return (
      <p className="mx-4 mt-2 text-sm text-gray-500">
        No history yet.
      </p>
    );
  }

  /* helper to map types → human label */
  const getLabel = (t: HistoryItem['type']) => {
    switch (t) {
      case 'EARN':          return 'Earned MiniMiles';
      case 'SPEND':         return 'Spent MiniMiles';
      case 'RAFFLE_ENTRY':  return 'Raffle entry';
      case 'RAFFLE_WIN':    return 'Raffle win';
      case 'RAFFLE_RESULT': return 'Raffle result';   // 🆕
      default:              return t;
    }
  };

  return (
    <div className="space-y-3 mx-4">
      {items.map(it => (
        <div
          key={it.id}
          className="p-3 flex justify-between border border-[#238D9D4D] font-sterling rounded-3xl bg-white"
        >
          <div className="flex flex-col">
            <div className="flex gap-1 items-center">
              <h3 className="font-medium">{getLabel(it.type)}</h3>
              <p className="text-gray-500 font-light">
                · {dayjs.unix(it.ts).format('DD/MM/YY')}
              </p>
            </div>

            {/* note already contains winner address for RAFFLE_RESULT */}
            <p className="text-gray-500 font-light">{it.note}</p>
          </div>

          {/* future “View” button placeholder
          <button className="text-[#219653] bg-[#ADF4FF80] rounded-full px-3">
            View
          </button> */}
        </div>
      ))}
    </div>
  );
}
