import * as SecureStore from 'expo-secure-store';

/**
 * A stable per-install identifier, so re-registering after a token rotation
 * updates this install's row instead of adding another one
 * (hub_user_devices has a UNIQUE on (hub_user_id, installation_id)).
 *
 * Kept in SecureStore alongside the session rather than regenerated per
 * launch: a new id every cold start would leave a trail of dead
 * registrations, and every one of them would be sent to until its token
 * failed.
 *
 * Not an identity or a secret — it says "this app install", nothing about
 * the member, and a reinstall is expected to produce a new one.
 */
const KEY = 'akiba.push.installationId';

// Device-local, non-identifying, and only ever compared for equality, so
// Math.random is sufficient; this is not used for anything security-bearing.
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

let cached: string | null = null;

export async function getInstallationId(): Promise<string> {
  if (cached) return cached;

  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
  } catch {
    // A read failure must not stop registration; a fresh id below is
    // correct-but-duplicated at worst, and the old row ages out when its
    // token stops working.
  }

  const created = uuidv4();
  try {
    await SecureStore.setItemAsync(KEY, created);
  } catch {
    // Unwritable store: this launch still registers, the next one re-rolls.
  }
  cached = created;
  return created;
}

/** Test seam — resets the in-process cache. */
export function resetInstallationIdCache(): void {
  cached = null;
}
