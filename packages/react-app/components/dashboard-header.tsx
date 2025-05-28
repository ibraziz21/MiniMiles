import { GearSvg, NotificationSvg } from "@/lib/svg";
import { Question } from "@phosphor-icons/react";
import { BellIcon } from "@radix-ui/react-icons";
import Image from "next/image";
import Link from "next/link";

export default function DashboardHeader({ name }: { name: any }) {
  return (
    <div className="px-4 pt-4 flex justify-between items-center">
      <h1 className="text-xl font-medium mt-2">Welcome {name}!</h1>

      <div className="flex">
        <Image src={GearSvg} alt="" />
        <Link href="/onboarding" >
          <Question size={24} color="#219653" weight="duotone" />
        </Link>
      </div>
    </div>
  );
}