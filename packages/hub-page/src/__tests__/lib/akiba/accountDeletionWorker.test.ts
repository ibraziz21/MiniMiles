import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  hub_user_id: string;
  status: string;
  attempts: number;
  completion_contact_ciphertext: string | null;
  completion_contact_key_version: string | null;
};

const state = vi.hoisted(() => ({
  claimed: [] as Row[],
  /** table -> deletes recorded as `${column}=${value}` */
  deletes: [] as { table: string; column: string; value: string }[],
  storageRemovals: [] as { bucket: string; keys: string[] }[],
  events: [] as { request_id: string; event_type: string; metadata: Record<string, unknown> }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  photos: [
    { private_source_key: "u1/src.jpg", thumbnail_key: "u1/thumb.jpg", display_key: "u1/disp.jpg" },
  ] as { private_source_key: string; thumbnail_key: string; display_key: string }[],
  authDeletes: [] as { userId: string; soft: boolean }[],
  failingTable: null as string | null,
  failingSqlState: "55P03",
  inventoryApproved: true,
  executableRows: [] as { id: string; action: string }[],
  pushSubscriptions: [{ id: "sub-1" }, { id: "sub-2" }] as { id: string }[],
  emailClaimable: [] as Row[],
  emailConfigured: false,
}));

// An approved inventory, so the worker's processing path is exercised. The
// real inventory still has unapproved rows — that gate is asserted in
// accountDeletionPolicy.test.ts.
vi.mock("@/lib/akiba/accountDeletionPolicy", () => {
  class MockInventoryNotApprovedError extends Error {
    constructor(readonly unapprovedRowIds: string[]) {
      super("blocked");
      this.name = "InventoryNotApprovedError";
    }
  }
  return {
    InventoryNotApprovedError: MockInventoryNotApprovedError,
    assertInventoryApproved: () => {
      if (!state.inventoryApproved) throw new MockInventoryNotApprovedError(["reward_ledger"]);
    },
    executableInventoryRows: () => state.executableRows,
  };
});

vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: async () => "canonical-u1",
}));

vi.mock("@/lib/akiba/accountDeletionContact", () => ({
  decryptCompletionContact: (ciphertext: string | null) =>
    ciphertext ? "member@example.com" : null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "claim_account_deletion_requests") return { data: state.claimed, error: null };
      if (name === "claim_account_deletion_completion_emails") {
        return { data: state.emailClaimable, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          if (table === "merchant_visit_photos") {
            return Promise.resolve({ data: state.photos, error: null });
          }
          if (table === "web_push_subscriptions") {
            return Promise.resolve({ data: state.pushSubscriptions, error: null });
          }
          if (table === "account_deletion_events") {
            return {
              eq: () =>
                Promise.resolve({
                  data: state.events
                    .filter((e) => e.request_id === value && e.event_type === "step_completed")
                    .map((e) => ({ metadata: e.metadata })),
                  error: null,
                }),
            };
          }
          void column;
          return Promise.resolve({ data: [], error: null });
        },
      }),
      delete: () => ({
        eq: (column: string, value: string) => {
          if (state.failingTable === table) {
            return Promise.resolve({
              error: { message: `${table} row "member@example.com" is locked`, code: state.failingSqlState },
            });
          }
          state.deletes.push({ table, column, value });
          return Promise.resolve({ error: null });
        },
        in: (column: string, values: string[]) => {
          if (state.failingTable === table) {
            return Promise.resolve({
              error: { message: `${table} is locked`, code: state.failingSqlState },
            });
          }
          for (const value of values) state.deletes.push({ table, column, value });
          return Promise.resolve({ error: null });
        },
      }),
      insert: (payload: Record<string, unknown>) => {
        state.events.push({
          request_id: payload.request_id as string,
          event_type: payload.event_type as string,
          metadata: (payload.metadata ?? {}) as Record<string, unknown>,
        });
        return Promise.resolve({ error: null });
      },
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (keys: string[]) => {
          state.storageRemovals.push({ bucket, keys });
          return { error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (userId: string, soft: boolean) => {
          state.authDeletes.push({ userId, soft });
          return { error: null };
        },
      },
    },
  }),
}));

const { processAccountDeletionRequests } = await import("@/lib/akiba/accountDeletionWorker");
const { InventoryNotApprovedError } = await import("@/lib/akiba/accountDeletionPolicy");

/**
 * The rows that currently have executors, in the worker's own STEP_ORDER.
 * The policy-blocked rows (published_photos, unpublished_contributions,
 * pass_credentials, and the pseudonymise set) are covered by the
 * "fails loudly when a step has no executor" test instead.
 */
const EXECUTABLE_ROWS = [
  { id: "member_photo_objects", action: "delete" },
  { id: "profile_contact", action: "delete" },
  { id: "saved_merchants", action: "delete" },
  { id: "push_registrations", action: "delete" },
  { id: "wallet_links", action: "unlink" },
  { id: "deletion_challenges", action: "delete" },
  { id: "auth_identity", action: "delete" },
];

function requestRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "req-1",
    hub_user_id: "u1",
    status: "processing",
    attempts: 1,
    completion_contact_ciphertext: "\\xdeadbeef",
    completion_contact_key_version: "v1",
    ...overrides,
  };
}

describe("account deletion worker", () => {
  beforeEach(() => {
    state.claimed = [requestRow()];
    state.deletes = [];
    state.storageRemovals = [];
    state.events = [];
    state.rpcCalls = [];
    state.authDeletes = [];
    state.failingTable = null;
    state.failingSqlState = "55P03";
    state.inventoryApproved = true;
    state.executableRows = [...EXECUTABLE_ROWS];
    state.pushSubscriptions = [{ id: "sub-1" }, { id: "sub-2" }];
    state.emailClaimable = [];
    state.emailConfigured = false;
    state.photos = [
      { private_source_key: "u1/src.jpg", thumbnail_key: "u1/thumb.jpg", display_key: "u1/disp.jpg" },
    ];
  });

  it("refuses to claim anything while the retention inventory is unapproved", async () => {
    state.inventoryApproved = false;
    await expect(processAccountDeletionRequests()).rejects.toBeInstanceOf(InventoryNotApprovedError);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("completes a request and runs every step once", async () => {
    const summary = await processAccountDeletionRequests();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(summary.outcomes[0]).toMatchObject({ requestId: "req-1", result: "completed" });
    expect(summary.outcomes[0].stepsRun).toEqual(EXECUTABLE_ROWS.map((row) => row.id));
  });

  it("deletes Storage objects before the Auth user, in both buckets", async () => {
    await processAccountDeletionRequests();
    expect(state.storageRemovals).toEqual([
      { bucket: "discovery-visit-photos", keys: ["u1/src.jpg"] },
      { bucket: "discovery-visit-photos-derived", keys: ["u1/thumb.jpg", "u1/disp.jpg"] },
    ]);
    // Supabase refuses to delete a user that still owns Storage objects, so
    // this ordering is a correctness requirement, not a preference.
    const storageStep = state.events.findIndex((e) => e.metadata.step === "member_photo_objects");
    const authStep = state.events.findIndex((e) => e.metadata.step === "auth_identity");
    expect(storageStep).toBeGreaterThanOrEqual(0);
    expect(authStep).toBeGreaterThan(storageStep);
  });

  it("soft-deletes the Auth user last", async () => {
    await processAccountDeletionRequests();
    expect(state.authDeletes).toEqual([{ userId: "u1", soft: true }]);
  });

  it("deletes push delivery rows before the subscriptions they reference", async () => {
    // web_push_deliveries.subscription_id has no ON DELETE action, and a
    // campaign job's deliveries can point at this member's subscription, so
    // deleting subscriptions first fails on a constraint.
    await processAccountDeletionRequests();
    const order = state.deletes.map((d) => d.table);
    const firstDelivery = order.indexOf("web_push_deliveries");
    const subscriptions = order.indexOf("web_push_subscriptions");
    expect(firstDelivery).toBeGreaterThanOrEqual(0);
    expect(subscriptions).toBeGreaterThan(firstDelivery);
    expect(state.deletes.filter((d) => d.table === "web_push_deliveries").map((d) => d.value)).toEqual([
      "sub-1",
      "sub-2",
    ]);
  });

  it("deletes the username projection, not just the profile row", async () => {
    await processAccountDeletionRequests();
    const tables = state.deletes.map((d) => `${d.table}:${d.column}=${d.value}`);
    expect(tables).toContain("hub_user_profiles:user_id=u1");
    expect(tables).toContain("leaderboard_profiles:canonical_id=canonical-u1");
    expect(tables).toContain("leaderboard_username_changes:canonical_id=canonical-u1");
  });

  it("clears saves, preferences, devices, wallet links and challenges", async () => {
    await processAccountDeletionRequests();
    const tables = state.deletes.map((d) => d.table);
    for (const table of [
      "hub_user_profiles",
      "hub_user_saved_merchants",
      "hub_notification_preferences",
      "web_push_deliveries",
      "web_push_jobs",
      "web_push_subscriptions",
      "hub_user_wallets",
      "wallet_link_challenges",
      "account_deletion_challenges",
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("skips steps already marked complete when replaying a request", async () => {
    // At-least-once delivery means a replay is normal, not exceptional.
    state.events.push({
      request_id: "req-1",
      event_type: "step_completed",
      metadata: { step: "profile_contact" },
    });

    const summary = await processAccountDeletionRequests();
    expect(summary.outcomes[0].stepsRun).not.toContain("profile_contact");
    expect(state.deletes.some((d) => d.table === "hub_user_profiles")).toBe(false);
    expect(summary.completed).toBe(1);
  });

  it("fails loudly when a step has no executor instead of silently retaining data", async () => {
    // Every policy-blocked class lands here until its executor is written:
    // never a skip, so an account can't be reported deleted while a class
    // survives.
    state.executableRows = [...EXECUTABLE_ROWS, { id: "reward_ledger", action: "pseudonymize" }];
    const summary = await processAccountDeletionRequests();

    expect(summary).toMatchObject({ completed: 0, failed: 1 });
    expect(summary.outcomes[0]).toMatchObject({ failureCode: "step_executor_missing" });
    const finish = state.rpcCalls.find((c) => c.name === "finish_account_deletion_request");
    expect(finish?.args).toMatchObject({ p_outcome: "failed", p_failure_code: "step_executor_missing" });
    expect(state.authDeletes).toHaveLength(0);
  });

  it("records a bounded failure code, never the provider message or a row value", async () => {
    state.failingTable = "hub_user_profiles";
    const summary = await processAccountDeletionRequests();

    expect(summary.outcomes[0]).toMatchObject({ failureCode: "step_failed:profile_contact" });
    const serialized = `${JSON.stringify(state.rpcCalls)}${JSON.stringify(state.events)}`;
    expect(serialized).not.toContain("is locked");
    // The fake Postgres error quotes an address, the way a real constraint
    // violation can quote a row value.
    expect(serialized).not.toContain("member@example.com");
    // The SQLSTATE is safe and useful, so it is kept.
    expect(JSON.stringify(state.events)).toContain("55P03");
    // The Auth user survives a mid-run failure so the retry can finish.
    expect(state.authDeletes).toHaveLength(0);
  });

  it("completes the request without waiting on the completion email", async () => {
    // The account is already gone by then. Delivery is a separate, independently
    // retried pass, so a mail outage must not reopen a finished deletion or
    // keep it out of `completed`.
    const summary = await processAccountDeletionRequests();
    expect(summary.completed).toBe(1);

    const finish = state.rpcCalls.find((c) => c.name === "finish_account_deletion_request");
    expect(finish?.args.p_outcome).toBe("completed");
  });

  it("skips the delivery pass entirely while no transport is configured", async () => {
    // Claiming would only burn attempts toward the give-up threshold and
    // purge contacts a future provider could still use.
    state.emailClaimable = [requestRow()];
    const summary = await processAccountDeletionRequests();

    expect(summary.completionEmails).toEqual({ claimed: 0, delivered: 0, failed: 0, skipped: 1 });
    expect(state.rpcCalls.some((c) => c.name === "claim_account_deletion_completion_emails")).toBe(
      false,
    );
    expect(state.rpcCalls.some((c) => c.name === "purge_account_deletion_contact")).toBe(false);
  });

  it("never claims a completed request for processing again", async () => {
    // `completed` is terminal. A pending email must not drag it back into
    // `processing`, which is why delivery has its own claim function.
    await processAccountDeletionRequests();
    const claims = state.rpcCalls.filter((c) => c.name === "claim_account_deletion_requests");
    expect(claims).toHaveLength(1);
    expect(state.rpcCalls.filter((c) => c.name === "finish_account_deletion_request")).toHaveLength(1);
  });

  it("refuses to run when the inventory and the step order disagree", async () => {
    // A data class with no place in the foreign-key order would otherwise
    // execute at an arbitrary point and fail on a constraint.
    state.executableRows = [...EXECUTABLE_ROWS, { id: "a_new_data_class", action: "delete" }];
    await expect(processAccountDeletionRequests()).rejects.toThrow(/a_new_data_class/);
    expect(state.deletes).toHaveLength(0);
  });

  it("writes no email, wallet or token into event metadata", async () => {
    await processAccountDeletionRequests();
    const serialized = JSON.stringify(state.events);
    expect(serialized).not.toContain("member@example.com");
    expect(serialized).not.toContain("0x");
    expect(serialized).not.toContain("deadbeef");
  });
});
