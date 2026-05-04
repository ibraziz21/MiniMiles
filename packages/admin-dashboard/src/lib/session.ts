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
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8-hour sessions
  },
};
