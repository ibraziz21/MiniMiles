import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/api/auth-check"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const token = req.cookies.get("cto_token")?.value;
  if (token !== process.env.CTO_DASHBOARD_TOKEN) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
