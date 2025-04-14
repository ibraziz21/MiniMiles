// components/RafflesWonCard.tsx
import { Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react"; 
import WinningModal from "./winning-modal";

export default function RafflesWonCard() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-4 mt-6">
      <h3 className="text-lg font-semibold">Raffles you won</h3>
      <p className="text-sm text-gray-500">Congratulations, Jane!</p>
      <div className="bg-gray-100 rounded-xl p-4 mt-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Flame className="text-orange-500" />
          <div>
            <p className="text-sm font-medium">You won the weekly raffle!</p>
            <p className="text-xs text-gray-500">You just received $500</p>
          </div>
        </div>
        <Button title="View" onClick={() => { setOpen(true) }} variant="ghost" className="text-green-600 font-semibold">
          View
        </Button>
      </div>
      <WinningModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
