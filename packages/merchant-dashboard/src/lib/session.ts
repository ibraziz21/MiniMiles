import { SessionOptions } from "iron-session";
import type { MerchantSessionData } from "@/types";

export type { MerchantSessionData };

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "merchant_auth",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8-hour sessions
  },
};
