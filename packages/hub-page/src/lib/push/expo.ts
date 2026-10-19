// Expo Push transport for native devices.
//
// Deliberately no `expo-server-sdk` dependency: the only thing this needs is
// one documented HTTP endpoint, and going direct keeps the send path
// mockable with a plain `fetch` stub (which is what the unit tests do) and
// keeps hub-page's dependency surface flat. Chunking and ticket
// classification — the two things the SDK would otherwise provide — are the
// small, well-tested functions below.
//
// Transport choice is recorded in the migration plan's "Push notifications"
// section: Expo Push first, with hub_user_devices.native_device_token
// reserved so a later move to direct APNs/FCM is additive.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Expo accepts at most 100 messages per request.
export const EXPO_PUSH_CHUNK_SIZE = 100;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
  channelId?: string;
};

/** One entry of Expo's `data` array, positionally matched to the request. */
export type ExpoPushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

/**
 * How a ticket maps onto the shared delivery vocabulary
 * (web_push_deliveries / native_push_deliveries `status`).
 *
 * `retireDevice` marks the registration unusable — the native equivalent of
 * a 404/410 from a Web Push endpoint. `configError` means the failure is
 * ours and global (bad or missing credentials), so the caller must re-arm
 * the job without blaming individual devices, exactly as the web adapter
 * does for a uniform 401/403.
 */
export type ExpoTicketOutcome = {
  status: "accepted" | "retry" | "gone" | "failed";
  retireDevice: boolean;
  configError: boolean;
  error: string | null;
  ticketId: string | null;
};

export function classifyExpoTicket(ticket: ExpoPushTicket): ExpoTicketOutcome {
  if (ticket.status === "ok") {
    return { status: "accepted", retireDevice: false, configError: false, error: null, ticketId: ticket.id };
  }

  const code = ticket.details?.error ?? null;
  const error = code ? `${code}: ${ticket.message}` : ticket.message;

  switch (code) {
    // The app was uninstalled, or the token was rotated/revoked. Never retry.
    case "DeviceNotRegistered":
      return { status: "gone", retireDevice: true, configError: false, error, ticketId: null };
    // Expo is throttling us; the notification is still valid.
    case "MessageRateExceeded":
      return { status: "retry", retireDevice: false, configError: false, error, ticketId: null };
    // Our credentials/project are wrong — every device would fail the same
    // way, so this must not retire any of them.
    case "InvalidCredentials":
    case "MismatchSenderId":
      return { status: "retry", retireDevice: false, configError: true, error, ticketId: null };
    // A payload bug. Retrying sends the same oversized payload again.
    case "MessageTooBig":
      return { status: "failed", retireDevice: false, configError: false, error, ticketId: null };
    default:
      return { status: "failed", retireDevice: false, configError: false, error, ticketId: null };
  }
}

export function chunkExpoMessages<T>(messages: T[], size = EXPO_PUSH_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const chunks: T[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}

/**
 * An Expo access token is only required when the project has enhanced push
 * security enabled, so its absence is not a configuration error the way a
 * missing VAPID key is. What *is* required is knowing which transport to
 * use at all: `nativePushConfigured()` is the switch the bootstrap
 * capability and the dispatcher both read, so a deployment that has not
 * been set up for native push sends nothing rather than failing per job.
 */
export function nativePushConfigured(): boolean {
  return (process.env.NATIVE_PUSH_ENABLED ?? "").trim().toLowerCase() === "true";
}

export class ExpoPushTransportError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly retryable: boolean,
    readonly configError = false,
  ) {
    super(message);
    this.name = "ExpoPushTransportError";
  }
}

/**
 * Sends one chunk and returns its tickets, positionally aligned with
 * `messages`. Throws ExpoPushTransportError when the whole request failed,
 * which the caller treats as "every message in this chunk" rather than
 * guessing per device.
 */
export async function sendExpoPushChunk(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();

  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    // Network-level failure: nothing was delivered and nothing is known to
    // be broken about the devices themselves.
    throw new ExpoPushTransportError((err as Error)?.message ?? "expo push request failed", null, true);
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const configError = response.status === 401 || response.status === 403;
    throw new ExpoPushTransportError(
      `expo push responded ${response.status}`,
      response.status,
      retryable || configError,
      configError,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: ExpoPushTicket[]; errors?: { message?: string }[] }
    | null;

  if (body?.errors?.length) {
    const message = body.errors.map((entry) => entry.message ?? "unknown").join("; ");
    throw new ExpoPushTransportError(`expo push rejected the request: ${message}`, response.status, false, true);
  }

  const tickets = body?.data;
  if (!Array.isArray(tickets) || tickets.length !== messages.length) {
    // A mismatched ticket array cannot be aligned to devices, so treating it
    // as retryable is the only safe reading — recording arbitrary outcomes
    // against real devices would be worse than trying again.
    throw new ExpoPushTransportError("expo push returned an unusable ticket array", response.status, true);
  }

  return tickets;
}
