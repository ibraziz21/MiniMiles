"use client";

import React from "react";
import { useRouter } from "next/navigation"; // Adjust the path as needed
import Image from "next/image";
// import { NexusLogo } from "@/constants/svg";

import { onboardingSource } from "@/helpers/onboardingSource";
// import { gsap } from "gsap";
// import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import Link from "next/link";

// gsap.registerPlugin(ScrollTrigger);

const Onboarding = () => {
  const router = useRouter();

  // useEffect(() => {
  //   // Check if the user is already logged in
  //   if (user) {
  //     // User is logged in, redirect to homepage
  //     router.replace("/home"); // Adjust this to your homepage route
  //   }
  //   // Else, stay on the onboarding page, allowing the user to navigate to login manually

  //   ScrollTrigger.create({
  //     trigger: "#animate",
  //     start: "right top",
  //     endTrigger: "#animate",
  //     end: "+=700",
  //     pin: true,
  //     horizontal: true,
  //   });
  // }, [router, user]); // Add `user` dependency to react to changes in authentication status

  return (
    <main className="onboarding-bg">
      <div className="xsm:flex justify-center">
        <Carousel className="xsm:w-[400px]">
          <CarouselContent>
            {onboardingSource.map((element, index) => {
              return (
                <CarouselItem key={index}>
                  <div className="flex flex-col justify-around h-[400px]">
                    <h2 className="text-4xl text-black font-bold">
                      {element.title}
                    </h2>
                    <h4 className="text-black my-5">{element.subtitle}</h4>
                    <div className="flex flex-col justify-center">
                      <Link
                        href="/login"
                        className="bg-white p-3 rounded-2xl mt-5 font-bold cursor-pointer text-center w-full sm:w-[400px]"
                      >
                        {element.buttonText}
                      </Link>
                    </div>
                    <article className="flex justify-center">
                      <hr className={`mx-1 rounded-full border-[4px] ${index === 0 ? 'w-0  border-black' : 'border-gray-300'}`} />
                      <hr className={`mx-1 rounded-full border-[4px] ${index === 1 ? 'w-0  border-black' : 'border-gray-300'}`} />
                      <hr className={`mx-1 rounded-full border-[4px] ${index === 2 ? 'w-0  border-black' : 'border-gray-300'}`} />
                    </article>
                  </div>
                </CarouselItem>
              );
            })}
          </CarouselContent>
        </Carousel>
      </div>
    </main>
  );
};

export default Onboarding;
