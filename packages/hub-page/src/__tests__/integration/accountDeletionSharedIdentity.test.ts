/**
 * Real-Postgres coverage for the four shared-identity deletion steps added in
 * migration 105.
 *
 * The mocked worker tests cannot prove any of this. A fake query builder has
 * no foreign keys, no NOT NULL and no triggers, so the two claims that matter
 * most here both pass vacuously there:
 *
 *   1. miles_ledger SURVIVES. canonical_id is NOT NULL on it, so the step
 *      pseudonymizes by removing identity_links — the only mapping from a
 *      canonical id to a person — rather than blanking the key. If that ever
 *      becomes a delete, merchant-settlement evidence goes with it.
 *   2. auth.users can actually be deleted. account_deletion_requests
 *      references it and is retained 24 months as proof, so the step has to
 *      release that reference in the same transaction. A constraint error
 *      here would strand a request *after* every earlier step has already
 *      destroyed the member's data.
 *
 * Run with:
 *   DELETION_INTEGRATION_DB_URL=postgres://... pnpm test:integration
 *
 * Deliberately a dedicated variable rather than DATABASE_URL: this test
 * writes and deletes rows, and must never inherit a production URL that
 * happens to be exported in the shell.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DELETION_INTEGRATION_DB_URL?.trim();

/** A project ref in the app's own Supabase URL is production. Never that. */
function refusesProduction(url: string): boolean {
  const productionHost = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!productionHost) return false;
  const ref = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(productionHost)?.[1];
  return Boolean(ref && url.includes(ref));
}

const suite = DB_URL ? describe : describe.skip;

suite("account deletion — shared identity steps (migration 105)", () => {
  let db: Client;

  // One throwaway member, built from scratch and removed either way.
  const userId = "00000000-dead-4000-8000-000000000105";
  const canonicalId = "00000000-dead-4000-8000-0000000c0105";
  const requestId = "00000000-dead-4000-8000-0000000f0105";
  const ledgerId = "00000000-dead-4000-8000-0000000e0105";
  const email = `deletion-integration-${userId.slice(-6)}@example.invalid`;

  beforeAll(async () => {
    if (!DB_URL) return;
    if (refusesProduction(DB_URL)) {
      throw new Error(
        "DELETION_INTEGRATION_DB_URL points at the production project. Refusing to run.",
      );
    }
    db = new Client({ connectionString: DB_URL });
    await db.connect();

    await db.query("BEGIN");
    await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [userId, email]);
    await db.query(
      "INSERT INTO public.hub_user_canonicals (hub_user_id, canonical_id, created_at) VALUES ($1,$2,now())",
      [userId, canonicalId],
    );
    await db.query(
      `INSERT INTO public.identity_links (id, canonical_id, identity_type, identity_value, created_at)
       VALUES (gen_random_uuid(), $1, 'email', $2, now())`,
      [canonicalId, email],
    );
    // The row that must outlive the member.
    await db.query(
      `INSERT INTO public.miles_ledger (id, canonical_id, amount, direction, source_type, created_at)
       VALUES ($1, $2, 25, 'credit', 'integration_test', now())`,
      [ledgerId, canonicalId],
    );
    await db.query(
      `INSERT INTO public.hub_user_wallets (id, user_id, ecosystem, address, is_primary, linked_at, verification_status)
       VALUES (gen_random_uuid(), $1, 'celo', '0x00000000000000000000000000000000deadbeef', true, now(), 'verified')`,
      [userId],
    );
    await db.query(
      `INSERT INTO public.leaderboard_profiles (canonical_id, username, username_normalized, changed_at, created_at, updated_at)
       VALUES ($1, $2, $2, now(), now(), now())`,
      [canonicalId, `del_int_${userId.slice(-6)}`],
    );
    await db.query(
      `INSERT INTO public.leaderboard_username_changes (id, canonical_id, new_username, changed_at)
       VALUES (gen_random_uuid(), $1, $2, now())`,
      [canonicalId, `del_int_${userId.slice(-6)}`],
    );
    // Straight to 'processing': status='requested' would fire
    // revoke_deleted_member_access, which is a different step's concern.
    await db.query(
      `INSERT INTO public.account_deletion_requests
         (id, hub_user_id, status, source, policy_version, requested_at,
          target_completion_at, completion_email_attempts, attempts, updated_at)
       VALUES ($1, $2, 'processing', 'integration_test', 'test', now(),
               now() + interval '14 days', 0, 0, now())`,
      [requestId, userId],
    );
    await db.query("COMMIT");
  });

  afterAll(async () => {
    if (!db) return;
    // Best-effort teardown; the test may have removed some of these already,
    // and a failure part-way through must not leave the rest behind. Each
    // statement runs on its own so one error cannot abort the others.
    const cleanup: [string, string][] = [
      ["DELETE FROM public.miles_ledger WHERE id=$1", ledgerId],
      ["DELETE FROM public.account_deletion_evidence WHERE request_id=$1", requestId],
      ["DELETE FROM public.account_deletion_events WHERE request_id=$1", requestId],
      ["DELETE FROM public.account_deletion_requests WHERE id=$1", requestId],
      ["DELETE FROM public.identity_links WHERE canonical_id=$1", canonicalId],
      ["DELETE FROM public.leaderboard_username_changes WHERE canonical_id=$1", canonicalId],
      ["DELETE FROM public.leaderboard_profiles WHERE canonical_id=$1", canonicalId],
      ["DELETE FROM public.hub_user_canonicals WHERE canonical_id=$1", canonicalId],
      ["DELETE FROM public.hub_user_wallets WHERE user_id=$1", userId],
      ["DELETE FROM public.wallet_link_challenges WHERE hub_user_id=$1", userId],
      ["DELETE FROM auth.users WHERE id=$1", userId],
    ];
    for (const [statement, parameter] of cleanup) {
      await db.query(statement, [parameter]).catch(() => undefined);
    }
    await db.end();
  });

  async function runStep(step: string): Promise<void> {
    await db.query("SELECT public.execute_account_deletion_step($1,$2)", [requestId, step]);
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await db.query<{ n: string }>(sql, params);
    return Number(rows[0].n);
  }

  it("unlinks wallets and spent challenges", async () => {
    expect(
      await count("SELECT count(*) n FROM public.hub_user_wallets WHERE user_id=$1", [userId]),
    ).toBe(1);

    await runStep("wallet_links");

    expect(
      await count("SELECT count(*) n FROM public.hub_user_wallets WHERE user_id=$1", [userId]),
    ).toBe(0);
    expect(
      await count("SELECT count(*) n FROM public.wallet_link_challenges WHERE hub_user_id=$1", [userId]),
    ).toBe(0);
  });

  it("removes the leaderboard projection keyed by canonical id", async () => {
    await runStep("shared_profile_projection");

    expect(
      await count("SELECT count(*) n FROM public.leaderboard_profiles WHERE canonical_id=$1", [canonicalId]),
    ).toBe(0);
    expect(
      await count("SELECT count(*) n FROM public.leaderboard_username_changes WHERE canonical_id=$1", [canonicalId]),
    ).toBe(0);
  });

  it("pseudonymizes the canonical identity without destroying the ledger", async () => {
    await runStep("canonical_identity");

    // The mapping to a person is gone...
    expect(
      await count("SELECT count(*) n FROM public.identity_links WHERE canonical_id=$1", [canonicalId]),
    ).toBe(0);
    expect(
      await count("SELECT count(*) n FROM public.hub_user_canonicals WHERE hub_user_id=$1", [userId]),
    ).toBe(0);

    // ...and the settlement evidence is not. This is the whole point of the
    // row's `pseudonymize` action, and the assertion most worth having.
    const { rows } = await db.query<{ canonical_id: string; amount: number }>(
      "SELECT canonical_id, amount FROM public.miles_ledger WHERE id=$1",
      [ledgerId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(25);
    // Still its original id, now resolving to nobody.
    expect(rows[0].canonical_id).toBe(canonicalId);
  });

  it("deletes the Auth user and keeps the deletion record as proof", async () => {
    await runStep("auth_identity");

    expect(await count("SELECT count(*) n FROM auth.users WHERE id=$1", [userId])).toBe(0);

    const { rows } = await db.query<{ hub_user_id: string | null; status: string }>(
      "SELECT hub_user_id, status FROM public.account_deletion_requests WHERE id=$1",
      [requestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hub_user_id).toBeNull();
    expect(rows[0].status).toBe("processing");
  });

  it("refuses a further step once the identity is gone", async () => {
    // hub_user_id is null now, so the function's own guard must reject rather
    // than operate on a NULL user and silently match nothing.
    await expect(runStep("wallet_links")).rejects.toThrow(/request is not processing/);
  });
});
