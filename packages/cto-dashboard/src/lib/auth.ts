import { NextRequest } from "next/server";

export function isAuthorized(req: NextRequest): boolean {
  const token = req.cookies.get("cto_token")?.value
    ?? req.headers.get("x-cto-token");
  return token === process.env.CTO_DASHBOARD_TOKEN;
}
