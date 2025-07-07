import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

export interface ActionPillProps {
    icon: string;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
}

export const ActionPill = ({
    icon,
    label,
    onClick,
    disabled,
    className,
}: ActionPillProps) => {
    const base =
        "w-full rounded-2xl py-4 flex items-center justify-center gap-3 " +
        "font-medium tracking-wide shadow-sm text-[#238D9D] bg-action-button bg-[#238D9D1A] hover:bg-[#238D9D1A]" +
        "disabled:bg-[#238D9D1A]";

    return (
        <div
            
            className={clsx(base, className, disabled && "pointer-events-none")}
            aria-disabled={disabled}
        >
            <Image src={icon} alt="Chat icon" width={24} height={24} className="text-[#238D9D]" />
            <span>{label}</span>
        </div>
    )
};
