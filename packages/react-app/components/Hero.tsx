'use client';

import { Button } from "@/components/ui/button";

export const Hero = () => {
  return (
    <section className="w-full bg-gradient-to-b from-[#d3f4e5] to-[#a6ddb3] py-10 px-2 text-left font-sterling">
      <p className="text-base font-medium mb-2 text-black">
        Use your MiniMiles to buy tickets
      </p>
      <h1 className="text-3xl font-extrabold text-black leading-snug mb-6">
        Win Big by <br />
        entering Our Raffles!
      </h1>
      <Button
        title="How to enter a raffle?"
        variant="outline"
        className="rounded-full border-2 border-[#a6ddb3] px-6 py-3 bg-[#d3f4e5] hover:bg-[#b2e2c5] w-full"
        onClick={() => {
          window.location.href = "/onboarding";
        }}
      >
        How to enter a raffle?
      </Button>
    </section>
  );
};
