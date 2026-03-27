import { SessionOptions } from "iron-session";

export interface SessionData {
  walletAddress: string; // verified, lowercase
  issuedAt: number;      // unix ms
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "minimiles_auth",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24, // 24 hours
  },
};
