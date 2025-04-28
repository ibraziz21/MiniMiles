import { BellIcon } from "@radix-ui/react-icons";

export default function DashboardHeader({ name }: { name: string }) {
    return (
      <div className="px-4 pt-4 flex justify-between items-center">
        <h1 className="text-xl font-bold mt-2">Welcome {name}!</h1>
        <BellIcon color="#219653" width={24} height={24} />
      </div>
    );
}