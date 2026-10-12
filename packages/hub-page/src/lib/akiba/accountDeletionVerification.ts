/**
 * Residue verification for a processed account deletion (AKIBA-MOB-002 §18:
 * "before/after fixture inventory for a fully processed account").
 *
 * This is the harness the executors are graded against, and it is
 * deliberately independent of which retention decisions land. It derives its
 * table list from `DELETION_INVENTORY`, so a new data class is covered the
 * moment it is added to the inventory rather than when someone remembers to
 * extend a test.
 *
 * What it can and cannot see, stated plainly because the difference matters
 * for what the release evidence is worth:
 *
 *   - **direct** — the table has a `hub_user_id` or `user_id` column, so
 *     residue for one member is a row count. These are checked.
 *   - **indirect** — the table is reached through another (photo jobs via
 *     photo id, contribution items via contribution id) or keyed by
 *     canonical id. A count here needs a join this harness does not invent;
 *     it reports them as unverified instead of implying they are clean.
 *   - **absent** — the table does not exist in this database. Reported, not
 *     skipped silently, because an executor aimed at a table that is not
 *     there would otherwise look like a pass.
 */
import { DELETION_INVENTORY, type DeletionAction } from "@/lib/akiba/accountDeletionPolicy";

/** The subset of `pg.Client`/`pg.Pool` this module needs. */
export type SqlRunner = {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type ResidueKind = "direct" | "indirect" | "absent";

export type TableResidue = {
  table: string;
  /** Inventory row that claims this table. */
  rowId: string;
  action: DeletionAction;
  /** Null when the retention terms are not approved yet. */
  approved: boolean;
  kind: ResidueKind;
  /** Rows still referencing the member. Null when not directly checkable. */
  rows: number | null;
  /** The column used, when `kind` is "direct". */
  column?: string;
};

export type ResidueReport = {
  userId: string;
  tables: TableResidue[];
  /** Tables an approved delete claims that still hold rows for the member. */
  violations: TableResidue[];
  /** Tables no count could be taken for — the evidence's blind spots. */
  unverified: TableResidue[];
};

const USER_COLUMNS = ["hub_user_id", "user_id"] as const;

/** Non-table inventory targets: storage buckets, processors, the chain. */
function isTableTarget(target: string): boolean {
  return !/^(storage|processor|chain):/.test(target);
}

/** table -> the inventory row that claims it. */
export function inventoryTableTargets(): { table: string; rowId: string; action: DeletionAction; approved: boolean }[] {
  const seen = new Map<string, { table: string; rowId: string; action: DeletionAction; approved: boolean }>();
  for (const row of DELETION_INVENTORY) {
    for (const target of row.targets) {
      if (!isTableTarget(target) || seen.has(target)) continue;
      seen.set(target, {
        table: target,
        rowId: row.id,
        action: row.action,
        approved: row.retention !== null,
      });
    }
  }
  return [...seen.values()];
}

async function resolveUserColumn(sql: SqlRunner, table: string): Promise<string | null | "absent"> {
  const { rows } = await sql.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  if (rows.length === 0) return "absent";
  const columns = new Set(rows.map((row) => row.column_name));
  return USER_COLUMNS.find((candidate) => columns.has(candidate)) ?? null;
}

/**
 * Counts what is left for `userId` in every table the inventory names.
 *
 * Safe to run before and after processing — the "before" run is what makes
 * the "after" run meaningful, since a table that was empty to begin with
 * proves nothing about the executor that claims it.
 */
export async function collectResidue(sql: SqlRunner, userId: string): Promise<ResidueReport> {
  const tables: TableResidue[] = [];

  for (const target of inventoryTableTargets()) {
    const column = await resolveUserColumn(sql, target.table);

    if (column === "absent") {
      tables.push({ ...target, kind: "absent", rows: null });
      continue;
    }
    if (column === null) {
      tables.push({ ...target, kind: "indirect", rows: null });
      continue;
    }

    // Identifiers come from information_schema, not from a caller, and the
    // member id is still bound as a parameter.
    const { rows } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.${target.table} WHERE ${column} = $1`,
      [userId],
    );
    tables.push({ ...target, kind: "direct", rows: Number(rows[0].count), column });
  }

  return {
    userId,
    tables,
    // Only an *approved* delete is a promise that nothing remains. A
    // pseudonymise row is expected to keep rows, and an unapproved row has
    // made no promise at all.
    violations: tables.filter(
      (entry) => entry.approved && entry.action === "delete" && (entry.rows ?? 0) > 0,
    ),
    unverified: tables.filter((entry) => entry.kind !== "direct"),
  };
}

export class ResidueError extends Error {
  constructor(readonly violations: TableResidue[]) {
    super(
      `Deletion left data behind: ${violations
        .map((entry) => `${entry.table}=${entry.rows}`)
        .join(", ")}`,
    );
    this.name = "ResidueError";
  }
}

export function assertNoResidue(report: ResidueReport): void {
  if (report.violations.length > 0) throw new ResidueError(report.violations);
}

/**
 * Operator/release-evidence rendering. Fixed-width and sorted so a before
 * and after run can be diffed, which is the artifact §18 asks to attach to
 * the release ticket.
 */
export function formatResidueReport(report: ResidueReport): string {
  const lines = [`account-deletion residue for ${report.userId}`, ""];
  const ordered = [...report.tables].sort((a, b) => a.table.localeCompare(b.table));
  for (const entry of ordered) {
    const count =
      entry.kind === "direct" ? String(entry.rows) : entry.kind === "absent" ? "no table" : "indirect";
    lines.push(
      `${entry.table.padEnd(42)} ${count.padStart(9)}  ${entry.action.padEnd(13)} ${
        entry.approved ? "approved" : "TBD"
      }  (${entry.rowId})`,
    );
  }
  lines.push("", `violations: ${report.violations.length}`, `unverified: ${report.unverified.length}`);
  return lines.join("\n");
}
