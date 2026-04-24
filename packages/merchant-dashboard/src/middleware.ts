import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "@/lib/session";
import type { MerchantSessionData } from "@/types";

const PUBLIC_PATHS = [
  "/login",
  "/accept-invite",
  "/reset-password",       // page — token is in the query string, no session needed
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/accept-invite",
  "/api/auth/confirm-reset",   // step 2: token consumption — no session needed
  // /api/auth/reset-password is intentionally NOT public:
  //   step 1 (issue token) requires an owner/manager session
  //   step 2 (consume token) is handled by the route itself without a session check
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check session
  const response = NextResponse.next();
  const session = await getIronSession<MerchantSessionData>(request, response, sessionOptions);

  if (!session.merchantUserId || !session.partnerId) {
    // API routes → 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes → redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // All routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
