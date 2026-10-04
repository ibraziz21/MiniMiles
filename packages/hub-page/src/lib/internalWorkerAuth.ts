import { timingSafeEqual } from "crypto";

function safeEqual(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

export function isInternalWorkerRequest(request: Request, allowCron = false): boolean {
  const webhookCandidate = request.headers.get("x-webhook-secret") ?? "";
  if (safeEqual(webhookCandidate, process.env.INTERNAL_WEBHOOK_SECRET ?? "")) return true;
  if (!allowCron) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return safeEqual(bearer, process.env.CRON_SECRET ?? "");
}
