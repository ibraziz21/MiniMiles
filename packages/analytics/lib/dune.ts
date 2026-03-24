const DUNE_API_BASE = "https://api.dune.com/api/v1";

function getApiKey() {
  return process.env.DUNE_API_KEY ?? "";
}

function normalizeQueryId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function getLatestQueryRows(queryId: string, columns?: string[]) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("DUNE_API_KEY is not configured");
  }

  const url = new URL(`${DUNE_API_BASE}/query/${queryId}/results`);
  if (columns?.length) {
    url.searchParams.set("columns", columns.join(","));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Dune-Api-Key": apiKey,
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Dune API request failed: ${res.status}`);
  }

  const json = await res.json();
  return Array.isArray(json?.result?.rows) ? json.result.rows : [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractScalarFromRow(
  row: Record<string, unknown>,
  preferredColumns: string[]
): number | null {
  for (const column of preferredColumns) {
    if (column in row) {
      const parsed = toNumber(row[column]);
      if (parsed !== null) return parsed;
    }
  }

  for (const value of Object.values(row)) {
    const parsed = toNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

export async function fetchDuneScalarMetric(opts: {
  queryIdEnv: string;
  columnEnv?: string;
  fallbackColumns?: string[];
}) {
  const queryId = normalizeQueryId(process.env[opts.queryIdEnv]);
  if (!queryId) return null;

  const explicitColumn = opts.columnEnv ? process.env[opts.columnEnv] : undefined;
  const columns = explicitColumn ? [explicitColumn] : opts.fallbackColumns;
  const rows = await getLatestQueryRows(queryId, columns);
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return null;

  return extractScalarFromRow(firstRow as Record<string, unknown>, [
    ...(explicitColumn ? [explicitColumn] : []),
    ...(opts.fallbackColumns ?? []),
  ]);
}
