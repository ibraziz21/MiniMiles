import { crackPotComingSoonResponse } from "@/lib/server/crackpotComingSoon";

export async function GET() {
  return crackPotComingSoonResponse();
}
