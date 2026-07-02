export type UpstreamJson = {
  data: unknown;
  status: number;
};

export const GAMES_PROXY_TIMEOUT_MS = Number(process.env.GAMES_PROXY_TIMEOUT_MS ?? "30000") || 30_000;
export const GAMES_STATUS_PROXY_TIMEOUT_MS = Number(process.env.GAMES_STATUS_PROXY_TIMEOUT_MS ?? "10000") || 10_000;

function parseJson(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function fetchUpstreamJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = GAMES_PROXY_TIMEOUT_MS,
): Promise<UpstreamJson> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await upstream.text();
    return {
      data: parseJson(text),
      status: upstream.status,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError";
}

export type DegradedError = {
  error: string;
  code: string;
  upstreamStatus?: number;
  degraded: true;
  retryable: boolean;
};

export function makeDegradedError(opts: {
  reason: "upstream-5xx" | "timeout" | "unreachable";
  upstreamStatus?: number;
}): DegradedError {
  if (opts.reason === "upstream-5xx") {
    return {
      error: "backend-error",
      code: "upstream-5xx",
      upstreamStatus: opts.upstreamStatus,
      degraded: true,
      retryable: true,
    };
  }
  if (opts.reason === "timeout") {
    return { error: "proxy-timeout", code: "timeout", degraded: true, retryable: true };
  }
  return { error: "backend-unavailable", code: "unreachable", degraded: true, retryable: true };
}
