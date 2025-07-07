/* app/(onboarding)/onboarding/page.tsx
   ─────────────────────────────────── */

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { CaretLeft } from "@phosphor-icons/react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselApi,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import { onboardingSource } from "@/helpers/onboardingSource"
import { useWeb3 } from "@/contexts/useWeb3"

export default function Onboarding() {
  const router = useRouter()
  const { address, getUserAddress } = useWeb3()

  /* slide controller */
  const [api, setApi] = useState<CarouselApi | null>(null)
  const [idx, setIdx] = useState(0)

  /* member flag from backend */
  const [isMember, setIsMember] = useState<boolean | null>(null)

  /* wallet address */
  useEffect(() => { getUserAddress() }, [getUserAddress])

  /* fetch member flag once address known */
  useEffect(() => {
    if (!address) return
    fetch(`/api/users/${address}`)
      .then(r => r.json())
      .then(({ isMember }) => setIsMember(!!isMember))
      .catch(() => setIsMember(false))
  }, [address])

  /* listen to slide change */
  useEffect(() => {
    if (!api) return                     // nothing yet

    const onSelect = () => setIdx(api.selectedScrollSnap())

    api.on("select", onSelect)
    onSelect()

    // ------------- cleanup -------------
    return () => {
      api.off("select", onSelect)        // ← now the cleanup returns void
    }
  }, [api])

  const isLast = idx === onboardingSource.length - 1

  /* finish */
  const finish = async () => {
    if (address && isMember === false) {
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      })
    }
    router.push("/")
  }
  const label = isLast
    ? isMember ? "Finish" : "Claim 100 MiniMiles"
    : "Next";
  return (
    <div className="relative h-screen font-sterling bg-white">
      {/* Skip / Skip & Claim */}
      <div className="absolute top-4 right-4 z-10">
        <button
          className="text-sm font-medium text-green-600 hover:underline"
          onClick={finish}
        >
          {isMember ? "Skip" : "Skip & Claim"}
        </button>
      </div>

      <Carousel setApi={setApi}>
        <CarouselContent className="h-screen">
          {onboardingSource.map((step, i) => (
            <CarouselItem key={i}>
              <div className="flex flex-col items-center justify-center h-full px-6 bg-onboarding bg-no-repeat bg-cover">
                {/* back */}
                {i > 0 && (
                  <button
                    className="self-start mb-4"
                    onClick={() => api?.scrollPrev()}
                  >
                    <CaretLeft size={24} className="text-black" />
                  </button>
                )}

                <Image src={step.img} alt={step.title} />

                <div>
                  <h2 className="mt-5 text-4xl font-[900] text-black">
                    {step.title}
                  </h2>
                  <h4 className="my-5 text-[#00000080] font-poppins">{step.subtitle}</h4>

                  {/* progress */}
                  <div className="flex mb-10 space-x-2">
                    {onboardingSource.map((_, j) => (
                      <span
                        key={j}
                        className={`h-2 w-8 rounded-full ${j === i ? "bg-[#238D9D]" : "bg-[#07955F4D]"
                          }`}
                      />
                    ))}
                  </div>
                </div>


                <button
                  className="w-full h-[56px] font-medium bg-[#07955F] text-white hover:bg-[#07955F] rounded-2xl"
                  onClick={() => (isLast ? finish() : api?.scrollNext())}
                /* title is optional; you can keep it if you want the hover tooltip */
                >
                  {label}   {/* ← visible text */}
                </button>



              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  )
}
