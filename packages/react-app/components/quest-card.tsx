
import { Clock } from "lucide-react";

interface QuestCardProps {
  title: string;
  description: string;
  reward: string;
   onClick?: () => void | Promise<void>;
}

export default function QuestCard({ title, description, reward, onClick }: QuestCardProps) {
  return (

    <div className="bg-green-100 rounded-xl p-4 min-w-[160px] flex-shrink-0"  onClick={onClick}>
      <div className="flex justify-between items-center mb-2">
        <Clock size={16} className="text-gray-600" />
        <span className="text-xs text-[#238D9D]">{reward}</span>
      </div>
      <p className="font-medium text-sm">{title}</p>
      <p className="text-xs text-gray-600 mt-1">{description}</p>
    </div>
  );
}
