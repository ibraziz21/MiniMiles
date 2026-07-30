export const DIRECTORY_SECTIONS = [
  { key: "business", label: "Business identity" },
  { key: "categories", label: "Categories" },
  { key: "offerings", label: "Core offerings" },
  { key: "locations", label: "Locations" },
  { key: "contact", label: "Public contacts" },
] as const;

export type DirectorySectionKey = (typeof DIRECTORY_SECTIONS)[number]["key"];
export type DirectoryModerationAction = "publish" | "request_changes" | "suspend" | "restore";
export type DirectoryStatus =
  | "draft"
  | "pending_review"
  | "changes_requested"
  | "published"
  | "paused"
  | "suspended";

const ACTIONS = new Set<DirectoryModerationAction>([
  "publish",
  "request_changes",
  "suspend",
  "restore",
]);
const SECTION_KEYS = new Set<DirectorySectionKey>(DIRECTORY_SECTIONS.map((section) => section.key));
const ALLOWED_KEYS = new Set(["action", "affectedSections", "merchantSafeMessage", "internalNote"]);

export interface ModerationRequest {
  action: DirectoryModerationAction;
  affectedSections: DirectorySectionKey[];
  merchantSafeMessage: string | null;
  internalNote: string | null;
}

type ParseResult =
  | { ok: true; value: ModerationRequest }
  | { ok: false; error: string };

function optionalTrimmedString(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maximum) return undefined;
  return trimmed;
}

export function parseModerationRequest(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "The request body must be an object." };
  }

  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, error: "The request contains unsupported fields." };
  }

  if (typeof body.action !== "string" || !ACTIONS.has(body.action as DirectoryModerationAction)) {
    return { ok: false, error: "Choose a valid review action." };
  }
  const action = body.action as DirectoryModerationAction;

  const rawSections = body.affectedSections ?? [];
  if (
    !Array.isArray(rawSections)
    || rawSections.some((section) => typeof section !== "string" || !SECTION_KEYS.has(section as DirectorySectionKey))
  ) {
    return { ok: false, error: "Choose only valid profile sections." };
  }
  const affectedSections = [...new Set(rawSections)] as DirectorySectionKey[];

  const merchantSafeMessage = optionalTrimmedString(body.merchantSafeMessage, 1000);
  if (merchantSafeMessage === undefined) {
    return { ok: false, error: "The merchant message must be 1,000 characters or fewer." };
  }

  const internalNote = optionalTrimmedString(body.internalNote, 2000);
  if (internalNote === undefined) {
    return { ok: false, error: "The internal note must be 2,000 characters or fewer." };
  }

  if ((action === "request_changes" || action === "suspend") && !merchantSafeMessage) {
    return { ok: false, error: "Add a message the merchant can see before taking this action." };
  }

  return {
    ok: true,
    value: { action, affectedSections, merchantSafeMessage, internalNote },
  };
}

export function directoryStatusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
