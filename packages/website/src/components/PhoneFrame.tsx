import Image from "next/image";
import { cn } from "@/lib/utils";

type PhoneFrameProps = {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
};

/**
 * Screenshots in public/app are the shipped Akiba screens, exported from
 * akiba-app's store assets at 660px wide (1080px device pixels downscaled).
 * The frame is drawn in CSS rather than baked into the PNG so the bezel
 * picks up the site's own line and surface colours.
 */
export function PhoneFrame({ src, alt, priority, className }: PhoneFrameProps) {
  return (
    <div
      className={cn(
        "relative w-full max-w-[278px] rounded-[2.4rem] border border-akiba-line bg-white p-2.5 shadow-soft",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[1.9rem] bg-akiba-card">
        <Image
          src={src}
          alt={alt}
          width={660}
          height={1481}
          priority={priority}
          sizes="278px"
          className="h-auto w-full"
        />
      </div>
    </div>
  );
}
