import { crackPotComingSoonResponse } from "@/lib/server/crackpotComingSoon";

export async function POST() {
  return crackPotComingSoonResponse();
}
