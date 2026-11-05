import { SessionOptions } from "iron-session";
import type { AdminSessionData } from "@/types";

export type { AdminSessionData };

const DEV_SESSION_SECRET =
  "akibamiles-admin-local-dev-session-secret-change-before-production";

function getSessionPassword() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  return DEV_SESSION_SECRET;
}

export const sessionOptions: SessionOptions = {
  password: getSessionPassword(),
  cookieName: "admin_auth",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    // Installed app launches and external links can arrive without a same-site
    // opener. Lax includes the cookie on top-level GETs, but not cross-site POSTs.
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8-hour sessions
  },
};
