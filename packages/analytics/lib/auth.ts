import { NextRequest } from "next/server";

export function checkApiAuth(request: NextRequest): boolean {
  const secret = process.env.ANALYTICS_SECRET;
  if (!secret) return false;

  // Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === secret) return true;
  }

  // Check query param
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret === secret) return true;

  return false;
}

export function getSecret(): string {
  return process.env.ANALYTICS_SECRET ?? "";
}
