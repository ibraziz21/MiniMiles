import { NextResponse } from "next/server";
import { fetchUpstreamJson, isAbortError, makeDegradedError } from "../_proxy";

export const FARKLE_BACKEND =
  process.env.FARKLE_SETTLEMENT_BACKEND_URL ??
  process.env.GAMES_BACKEND_URL ??
  "https://backend-production-aa7f.up.railway.app";

export const FARKLE_PROXY_TIMEOUT_MS =
  Number(process.env.FARKLE_PROXY_TIMEOUT_MS ?? process.env.GAMES_STATUS_PROXY_TIMEOUT_MS ?? "10000") || 10_000;

type BackendSecretCandidate = {
  label: "FARKLE_SETTLEMENT_SECRET" | "ADMIN_QUEUE_SECRET" | "CRON_SECRET";
  value: string;
};

function settlementSecrets(): BackendSecretCandidate[] {
  const candidates: BackendSecretCandidate[] = [
    { label: "FARKLE_SETTLEMENT_SECRET", value: process.env.FARKLE_SETTLEMENT_SECRET ?? "" },
    { label: "ADMIN_QUEUE_SECRET", value: process.env.ADMIN_QUEUE_SECRET ?? "" },
    { label: "CRON_SECRET", value: process.env.CRON_SECRET ?? "" },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.value || seen.has(candidate.value)) return false;
    seen.add(candidate.value);
    return true;
  });
}

function headersWithSecret(headers: HeadersInit | undefined, secret: string) {
  const next = new Headers(headers);
  next.set("authorization", `Bearer ${secret}`);
  return next;
}

export function farkleBackendHeaders(json = false): HeadersInit | null {
  const [secret] = settlementSecrets();
  if (!secret) return null;
  const headers = headersWithSecret(undefined, secret.value);
  if (json) headers.set("content-type", "application/json");
  return headers;
}

export function missingBackendSecret() {
  return NextResponse.json(
    { error: "backend auth not configured", degraded: true, retryable: false },
    { status: 500 },
  );
}

export async function proxyFarkleBackend(
  path: string,
  init: RequestInit,
  timeoutMs = FARKLE_PROXY_TIMEOUT_MS,
) {
  const url = `${FARKLE_BACKEND.replace(/\/$/, "")}${path}`;
  const configuredSecrets = settlementSecrets();
  const originalHeaders = new Headers(init.headers);
  const originalAuth = originalHeaders.get("authorization");
  const attempts: { label: string; headers: HeadersInit | undefined }[] = [
    { label: "provided", headers: init.headers },
  ];

  if (originalAuth) {
    for (const secret of configuredSecrets) {
      const auth = `Bearer ${secret.value}`;
      if (auth !== originalAuth) {
        attempts.push({
          label: secret.label,
          headers: headersWithSecret(init.headers, secret.value),
        });
      }
    }
  }

  try {
    let data: unknown = null;
    let status = 0;

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const upstream = await fetchUpstreamJson(url, { ...init, headers: attempt.headers }, timeoutMs);
      data = upstream.data;
      status = upstream.status;
      if (status !== 401 || i === attempts.length - 1) break;
      console.warn(
        `[farkle/backend] auth rejected using ${attempt.label}; retrying with ${attempts[i + 1].label}`,
      );
    }

    if (status === 401) {
      const labels = configuredSecrets.map((secret) => secret.label).join(",");
      console.warn(`[farkle/backend] upstream rejected all configured auth candidates: ${labels || "none"}`);
    }

    if (status >= 500) {
      return NextResponse.json(
        makeDegradedError({ reason: "upstream-5xx", upstreamStatus: status }),
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status });
  } catch (err) {
    return NextResponse.json(
      makeDegradedError({ reason: isAbortError(err) ? "timeout" : "unreachable" }),
      { status: 502 },
    );
  }
}
