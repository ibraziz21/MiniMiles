import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateCorrelationId, CORRELATION_ID_HEADER } from "@/lib/correlation";

const PROTECTED = ["/me", "/pass", "/welcome", "/referrals", "/games", "/earn"];

export async function middleware(request: NextRequest) {
  const correlationId = getOrCreateCorrelationId(request.headers);
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set(CORRELATION_ID_HEADER, correlationId);
    return redirect;
  }

  // Redirect logged-in users away from /login
  if (pathname === "/login" && user) {
    const next = request.nextUrl.searchParams.get("next") ?? "/me";
    const url = request.nextUrl.clone();
    url.pathname = next;
    url.searchParams.delete("next");
    const redirect = NextResponse.redirect(url);
    redirect.headers.set(CORRELATION_ID_HEADER, correlationId);
    return redirect;
  }

  supabaseResponse.headers.set(CORRELATION_ID_HEADER, correlationId);
  return supabaseResponse;
}

export const config = {
  matcher: ["/me/:path*", "/pass/:path*", "/welcome/:path*", "/referrals/:path*", "/games/:path*", "/games", "/earn/:path*", "/earn", "/login"],
};
