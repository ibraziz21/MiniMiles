// src/helpers/passOnboardingSource.ts
// Akiba Pass onboarding carousel — describes the Pass before sending the
// user to https://pass.akibamiles.com (same pattern as prosperityPassSource).
import type { StaticImageData } from "next/image";

// TODO: swap for the real Akiba Pass illustrations
// (PassOnboardingImgOne…Four) once exported to public/img.
import PassOnboardingImgOne from "@/public/img/pp1.png";
import PassOnboardingImgTwo from "@/public/img/pp2.png";
import PassOnboardingImgThree from "@/public/img/pp3.png";
import PassOnboardingImgFour from "@/public/img/pp4.png";

export type PassOnboardingStep = {
  img: StaticImageData;
  title: string;
  subtitle: string;
  line: string;
  buttonText: string;
  /** Optional numbered how-to steps rendered under the subtitle. */
  steps?: string[];
};

export const AKIBA_PASS_URL = "https://pass.akibamiles.com";

export const passOnboardingSource: PassOnboardingStep[] = [
  {
    img: PassOnboardingImgOne,
    title: "Meet the Akiba Pass",
    subtitle:
      "Your Miles now work in real shops. The Akiba Pass is your personal QR code — one scan at the till and you're earning.",
    line: "150px",
    buttonText: "Next",
  },
  {
    img: PassOnboardingImgTwo,
    title: "Earn when you shop",
    subtitle:
      "Show your Pass when you pay at partner shops and earn 1 Mile for every 100 KES you spend. Miles land instantly.",
    line: "150px",
    buttonText: "Next",
  },
  {
    img: PassOnboardingImgTwo,
    title: "Scan. Earn. Repeat.",
    subtitle: "Earning takes seconds at the counter:",
    steps: [
      "Pay at a partner shop as usual",
      "Open your Akiba Pass and show your QR code",
      "The cashier scans it — Miles land in your balance instantly",
    ],
    line: "150px",
    buttonText: "Next",
  },
  {
    img: PassOnboardingImgThree,
    title: "Unlock real deals",
    subtitle:
      "Spend Miles on discounts and vouchers at your favourite shops — and unlock badges for the best member-only offers.",
    line: "150px",
    buttonText: "Next",
  },
  {
    img: PassOnboardingImgFour,
    title: "Get your Pass",
    subtitle:
      "Sign in with the same email you use here, and your Miles come with you. Takes under a minute.",
    line: "150px",
    buttonText: "Get my Akiba Pass", // → https://pass.akibamiles.com
  },
];
