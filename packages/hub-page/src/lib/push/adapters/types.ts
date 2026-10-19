// Shared adapter contract. Each transport reports what it found and what
// happened; dispatch.ts folds those into the single job outcome that
// complete_web_push_job accepts, so retry/backoff and terminal-state
// protection stay shared between transports rather than being decided twice.
export type AdapterResult = {
  /** Active send targets this transport found for the member. */
  targets: number;
  /** Targets the provider accepted. */
  accepted: number;
  /** At least one target failed in a way worth retrying. */
  anyRetryable: boolean;
  /**
   * The failure is ours and global (bad credentials), not the targets'. The
   * caller must re-arm the job without retiring any registration.
   */
  configError: boolean;
  lastError: string | null;
};

export const NO_TARGETS: AdapterResult = {
  targets: 0,
  accepted: 0,
  anyRetryable: false,
  configError: false,
  lastError: null,
};

export type PushJob = {
  job_id: string;
  notification_id: string;
  hub_user_id: string;
  template: string;
  category: string;
  deep_link: string;
  metadata: Record<string, unknown>;
  attempts: number;
};
