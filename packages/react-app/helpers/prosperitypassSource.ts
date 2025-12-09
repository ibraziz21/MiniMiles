// src/helpers/prosperityPassSource.ts
import type { StaticImageData } from "next/image";

// swap these for your real illustrations
import slide1 from "@/public/img/pp1.png";
import slide2 from "@/public/img/pp2.png";
import slide3 from "@/public/img/pp3.png";
import slide4 from "@/public/img/pp4.png";

export type ProsperityPassStep = {
  title: string;
  subtitle: string;
  img: StaticImageData;
};

export const prosperityPassSource: ProsperityPassStep[] = [
  {
    title: "Prosperity Pass",
    subtitle:
      "The Prosperity Pass is an additional loyalty card inside your Akiba profile. It unlocks extra rewards based on your activity in MiniPay.",
    img: slide1,
  },
  {
    title: "Celo Network",
    subtitle:
      "Did you know that Minipay is built on the Celo blockchain? Celo is a frontier chain for global impact, focused on real-world solutions. ",
    img: slide2,
  },
  {
    title: "Claim Badges",
    subtitle:"Actively use applications inside of MiniPay to unlock additional badges. More badges = more chance to get rewarded!",
    img: slide3,
  },
  {
    title: "Get Rewarded",
    subtitle: "At the end of each Celo season - about once every 6 months - rewards will be distributed.  Start your journey now and claim your Prosperity Pass.",
    img: slide4,
  }
];
