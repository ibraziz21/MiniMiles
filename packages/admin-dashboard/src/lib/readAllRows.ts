export async function readAllRows<T>(
  read: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await read(from, from + 499);
    if (result.error) throw new Error("Data unavailable");
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

/** Bound reference IN queries so URLs and default API row caps cannot truncate them. */
export async function readReferenceChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < ids.length; from += 200) {
    const result = await read(ids.slice(from, from + 200));
    if (result.error) throw new Error("References unavailable");
    rows.push(...(result.data ?? []));
  }
  return rows;
}
