import { GearSvg, NotificationSvg } from "@/lib/svg";
import { BellIcon } from "@radix-ui/react-icons";
import Image from "next/image";

export default function DashboardHeader({ name }: { name: string }) {
    return (
      <div className="px-4 pt-4 flex justify-between items-center">
        <h1 className="text-xl font-bold mt-2">Welcome {name}!</h1>
        
        <div className="flex">
        <Image src={GearSvg} alt="" />
        <Image src={NotificationSvg} alt="" />
        </div>
      </div>
    );
}