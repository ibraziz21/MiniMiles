"use client";

import React from "react";
import { useRouter } from "next/navigation"; // Adjust the path as needed
import Image from "next/image";
import { onboardingSource } from "@/helpers/onboardingSource";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CaretLeft } from "@phosphor-icons/react";


const Onboarding = () => {
  const router = useRouter();

  const completeOnboarding = () => {
    localStorage.setItem("onboarding-complete", "true");
    router.push("/");
  };

  return (
    <Carousel className=" font-poppins xsm:flex justify-center h-screen m-0">
      <CarouselContent className="h-screen">
        {onboardingSource.map((element, index) => {
          return (
            <CarouselItem key={index}>
              <div className={`flex flex-col justify-center h-screen p-3 bg-onboarding  bg-no-repeat bg-cover ${index === 3 ? 'bg-[#219653]' : ''}`}>
                <div className={`flex justify-between items-center  ${index === 3 ? 'hidden' : ''}`}>
                  <CaretLeft size={24} />
                  <Link href="/" className="text-sm text-green-600 hover:underline font-bold">
                    Skip & Claim
                  </Link>
                </div>
                <div className="flex justify-center">
                  <Image src={element.img} alt="w-full" />
                </div>
                <h2 className={`text-4xl text-black font-bold mt-5  ${index === 3 ? 'text-white' : ''}`}>
                  {element.title}
                </h2>
                <h4 className={`text-[#00000080] my-5  ${index === 3 ? 'text-[#E6E6E6]' : ''}`}>{element.subtitle}</h4>
                <article className="flex justify-start mb-10">
                  <hr className={`mx-1 w-[30px] rounded-full border-[4px] ${index === 0 ? 'border-[#219653]' : 'border-[#07955F4D]'}`} />
                  <hr className={`mx-1 w-[30px] rounded-full border-[4px] ${index === 1 ? 'border-[#219653]' : 'border-[#07955F4D]'}`} />
                  <hr className={`mx-1 w-[30px] rounded-full border-[4px] ${index === 2 ? 'border-[#219653]' : 'border-[#07955F4D]'}`} />
                </article>
                <div className="flex flex-col justify-center">
                  <Button
                    title={element.buttonText}
                    onClick={completeOnboarding}
                    className={`w-full rounded-xl py-6 flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-white bg-[#07955F] hover:bg-[#07955F] ${index === 3 ? 'bg-white hover:bg-white text-[#219653]' : ''} disabled:bg-[#07955F]`}
                  >
                  </Button>
                </div>
              </div>
            </CarouselItem>
          );
        })}
      </CarouselContent>
    </Carousel>
  );
};

export default Onboarding;
