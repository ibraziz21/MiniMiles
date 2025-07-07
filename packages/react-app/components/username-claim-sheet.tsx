"use client";

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Link2Icon } from "@radix-ui/react-icons";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  address?: string | null;
  children: React.ReactNode; // the trigger (Button)
};

export default function UsernameClaimSheet({
  open,
  onOpenChange,
  username,
  address,
  children,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl pb-10 pt-6 bg-white">

        <div className="mx-auto mt-4 w-full max-w-xs space-y-4 rounded-2xl bg-muted p-5 text-center">
          <div className="flex items-center justify-center gap-1 text-xs font-medium">
            {address ? address : "0x…"} <Link2Icon />
            <span className="text-primarygreen">{username}.mini</span>
          </div>

          <h3 className="text-base font-medium">A simplified address</h3>
          <p className="text-sm text-muted-foreground">
            akibaMiles usernames transform complex&nbsp;0x addresses into
            readable names. By claiming a&nbsp;
            <span className="font-medium text-primarygreen">.mini</span> you can
            easily send and receive crypto and build out your public profile.
          </p>
        </div>

        
        <SheetFooter className="mt-8">
          <SheetClose asChild>
            <Button
              title="Close"
              widthFull
              variant="secondary"
              className="bg-[#07955F1A] text-[#07955F] rounded-md"
              onClick={() => onOpenChange(false)}
            />
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
