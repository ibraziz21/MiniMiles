// components/Progress/index.tsx
"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = ({
  className,
  value,
  ...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { value: number }) => {
  return (
    <ProgressPrimitive.Root
      className={cn("relative h-2 w-full overflow-hidden rounded-full", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full bg-primary transition-all", {
          "bg-dots": true,
        })}
        style={{
          transform: `translateX(-${(100 - value)}%)`,
        }}
      />
    </ProgressPrimitive.Root>
  );
};

export { Progress };