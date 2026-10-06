// Standard /api/v1 response envelope (hub-mobile-app-migration-plan.md
// "Response and error shape"). Every v1 route returns either apiSuccess or
// apiError — never a raw object — so the native client can rely on one
// shape across every endpoint.
import { NextResponse } from "next/server";

const API_VERSION = "v1";

export type ApiSuccessBody<T> = {
  data: T;
  meta: { requestId: string; apiVersion: typeof API_VERSION };
};

export type ApiErrorBody = {
  error: { code: string; message: string; retryable: boolean; requestId: string };
};

/** Echoes the native client's X-Request-Id when present, otherwise mints one. */
export function resolveRequestId(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

export function apiSuccess<T>(
  request: Request,
  data: T,
  init?: ResponseInit,
): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json(
    { data, meta: { requestId: resolveRequestId(request), apiVersion: API_VERSION } },
    init,
  );
}

export function apiError(
  request: Request,
  code: string,
  message: string,
  status: number,
  opts: { retryable?: boolean } = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        retryable: opts.retryable ?? false,
        requestId: resolveRequestId(request),
      },
    },
    { status },
  );
}
