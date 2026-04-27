import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "@/lib/session";
import type { AdminSessionData } from "@/types";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/bootstrap",
];

function isOpenAccessMode(): boolean {
  if (process.env.ADMIN_OPEN_ACCESS === "true") return true;
  if (process.env.ADMIN_OPEN_ACCESS === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (isOpenAccessMode()) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<AdminSessionData>(request, response, sessionOptions);

  if (!session.adminUserId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
