import { createHash } from "crypto";

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}
