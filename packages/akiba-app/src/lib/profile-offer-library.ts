import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
const offerSchema = z.object({ id: z.string(), title: z.string(), merchantName: z.string(), merchantSlug: z.string(), allocationId: z.string().optional() });
export type SavedOffer = z.infer<typeof offerSchema>;
const reminderSchema = offerSchema.extend({ leadMinutes: z.union([z.literal(30), z.literal(60), z.literal(1440)]) });
export type SavedServerReminder = z.infer<typeof reminderSchema>;
const schema = z.object({ likes: z.array(offerSchema), reminders: z.array(reminderSchema) });
export type OfferLibrary = z.infer<typeof schema>;
const key = (scope: string) => `akiba.profile-library.v1.${scope.replace(/[^A-Za-z0-9._-]/g, '_')}`;
export async function loadOfferLibrary(scope: string): Promise<OfferLibrary> {
  const raw = await SecureStore.getItemAsync(key(scope));
  return raw ? schema.parse(JSON.parse(raw)) : { likes: [], reminders: [] };
}
// Serialize writes from different screens so a reminder cannot overwrite a like.
let queue: Promise<unknown> = Promise.resolve();
function update(scope: string, change: (library: OfferLibrary) => OfferLibrary) {
  const task = queue.catch(() => undefined).then(async () => {
    const library = change(await loadOfferLibrary(scope));
    await SecureStore.setItemAsync(key(scope), JSON.stringify(library));
  });
  queue = task;
  return task;
}
export const saveLikedOffer = (scope: string, offer: SavedOffer) => update(scope, library => ({ ...library, likes: [offer, ...library.likes.filter(item => item.id !== offer.id)] }));
export const removeLikedOffer = (scope: string, id: string) => update(scope, library => ({ ...library, likes: library.likes.filter(item => item.id !== id) }));
export const rememberServerReminder = (scope: string, offer: SavedServerReminder) => update(scope, library => ({ ...library, reminders: [offer, ...library.reminders.filter(item => item.id !== offer.id)] }));
export const forgetServerReminder = (scope: string, id: string) => update(scope, library => ({ ...library, reminders: library.reminders.filter(item => item.id !== id) }));
