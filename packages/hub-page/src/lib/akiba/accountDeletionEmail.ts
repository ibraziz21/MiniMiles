/**
 * Completion-email transport for account deletion (AKIBA-MOB-002 §8.2 step
 * 13).
 *
 * hub-page has never sent transactional email — only web push — so this is
 * the first such path in the package. It is built as a provider interface
 * with one HTTP adapter rather than a direct call, for two reasons: the
 * provider is an open operational decision, and whichever one is chosen, the
 * worker's contract must not change.
 *
 * Off unless configured. `ACCOUNT_DELETION_EMAIL_PROVIDER` selects an
 * adapter; with no value the transport reports `not_configured` and the
 * worker skips the delivery pass entirely rather than burning retry attempts
 * against a transport that cannot exist. That is the honest default: the
 * member's data is still deleted on time, and the undelivered notice stays
 * visible in `account_deletion_reconciliation`.
 *
 * What this module must never do: log, store, or return the recipient
 * address. It receives it, uses it once, and the caller purges the
 * ciphertext it came from.
 */

export type DeliveryResult =
  | { delivered: true }
  /** Bounded code only — never a provider body, which can quote the address. */
  | { delivered: false; failureCode: string; retryable: boolean };

export type CompletionEmailMessage = {
  to: string;
  requestReference: string;
  completedAt: string;
};

type Adapter = (message: CompletionEmailMessage) => Promise<DeliveryResult>;

const SUBJECT = "Your Akiba native-app deletion is complete";

function body(message: CompletionEmailMessage): string {
  // Plain text on purpose. This is a legal notice, it must render in any
  // client, and it carries no link that could be mistaken for a sign-in.
  return [
    "Your Akiba native-app deletion request has been completed.",
    "This does not close your shared Akiba account or remove rewards in other Akiba services.",
    "",
    `Request reference: ${message.requestReference}`,
    `Completed: ${new Date(message.completedAt).toISOString().slice(0, 10)}`,
    "",
    "Minimal restricted evidence is retained for the periods described in the",
    "deletion notice and Privacy Policy.",
    "",
    "You do not need to do anything. If you did not request this, contact",
    "hello@akibamiles.com with the reference above.",
    "",
    "Akiba Ecosystems Ltd",
  ].join("\n");
}

function fromAddress(): string {
  return process.env.ACCOUNT_DELETION_EMAIL_FROM?.trim() || "Akiba <no-reply@akibamiles.com>";
}

/**
 * Resend's REST API — chosen as the first adapter because it is a single
 * authenticated POST with no SDK, so it adds no dependency to a package that
 * has none for email. Another provider is roughly this many lines.
 */
const resendAdapter: Adapter = async (message) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { delivered: false, failureCode: "provider_key_missing", retryable: false };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: SUBJECT,
        text: body(message),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // A transport failure is retryable; the reason is bounded to the error
    // name because a thrown fetch error can include the request URL and
    // headers.
    return {
      delivered: false,
      failureCode: error instanceof Error ? `transport_${error.name}` : "transport_unknown",
      retryable: true,
    };
  }

  if (response.ok) return { delivered: true };

  // Never read or forward the body: provider error payloads routinely echo
  // the recipient address back.
  return {
    delivered: false,
    failureCode: `provider_http_${response.status}`,
    // 4xx means the request itself is wrong (bad key, unverified domain,
    // rejected address) and will fail identically on retry; 5xx and 429 are
    // worth retrying.
    retryable: response.status >= 500 || response.status === 429,
  };
};

const ADAPTERS: Record<string, Adapter> = {
  resend: resendAdapter,
};

function selectedProvider(): string | null {
  const name = process.env.ACCOUNT_DELETION_EMAIL_PROVIDER?.trim().toLowerCase();
  return name && name in ADAPTERS ? name : null;
}

export function isCompletionEmailConfigured(): boolean {
  return selectedProvider() !== null;
}

/** The configured provider's name, for operator-facing output only. */
export function completionEmailProviderName(): string | null {
  return selectedProvider();
}

export async function sendCompletionEmail(
  message: CompletionEmailMessage,
): Promise<DeliveryResult> {
  const provider = selectedProvider();
  if (!provider) {
    return { delivered: false, failureCode: "email_transport_not_configured", retryable: false };
  }
  return ADAPTERS[provider](message);
}
