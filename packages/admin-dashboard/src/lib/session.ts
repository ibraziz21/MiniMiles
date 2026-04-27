import { SessionOptions } from "iron-session";
import type { AdminSessionData } from "@/types";

export type { AdminSessionData };

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "admin_auth",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8-hour sessions
  },
};
