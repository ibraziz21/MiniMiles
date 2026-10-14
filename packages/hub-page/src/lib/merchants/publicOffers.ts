import { HIDDEN_PARTNER_IDS } from "@/lib/akiba/hidden-partners";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMerchantOfferAvailability } from "./offerAvailability";
import type { PublicMerchantOfferFeedItem } from "./types";

const LOCAL_AKIBA_STORE_PREVIEW_ID = "4e229b5d-4676-4f73-8399-6ed86e0205d9";
const MEDIA_BUCKET = "merchant-assets";

type OfferRow = {
  id: string;
  title: string;
  description: string;
  terms: string | null;
  schedule: string;
  days_of_week: unknown;
  start_time: string | null;
  end_time: string | null;
  starts_on: string | null;
  ends_on: string | null;
  timezone: string;
  reminders_enabled: boolean;
  image_media_id: string | null;
  partners: PartnerRow | PartnerRow[];
};

type PartnerRow = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  type: string;
  status: string;
  partner_settings: PartnerSettingsRow | PartnerSettingsRow[] | null;
};

type PartnerSettingsRow = { directory_status: string | null };

type MediaRow = {
  id: string;
  status: string;
  display_key: string | null;
  thumbnail_key: string | null;
};

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.match(/^((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/)?.[1] ?? null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function isVisiblePartner(partner: PartnerRow): boolean {
  if (partner.type !== "merchant" || partner.status !== "active" || HIDDEN_PARTNER_IDS.includes(partner.id)) {
    return false;
  }
  const settings = first(partner.partner_settings);
  if (settings?.directory_status === "published") return true;
  return process.env.NODE_ENV === "development" && partner.id === LOCAL_AKIBA_STORE_PREVIEW_ID;
}

/**
 * Public merchant-owned offers for discovery surfaces. Failures intentionally
 * collapse to an empty list so Explore can omit the optional rail.
 */
export async function listPublicMerchantOffers(limit = 10): Promise<PublicMerchantOfferFeedItem[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  const admin = createAdminClient();

  try {
    const { data, error } = await admin
      .from("merchant_default_offers")
      .select(
        `id, title, description, terms, schedule, days_of_week, start_time, end_time,
         starts_on, ends_on, timezone, reminders_enabled, image_media_id,
         partners!inner (
           id, name, slug, image_url, type, status,
           partner_settings ( directory_status )
         )`
      )
      .eq("status", "live")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(safeLimit * 4, 100));

    if (error) {
      console.error("[merchant-offers] public query failed:", error.message);
      return [];
    }

    const rows = (data ?? []) as unknown as OfferRow[];
    const mediaIds = [...new Set(rows.map((row) => row.image_media_id).filter((id): id is string => Boolean(id)))];
    const mediaById = new Map<string, MediaRow>();

    if (mediaIds.length > 0) {
      const { data: mediaRows, error: mediaError } = await admin
        .from("merchant_profile_media")
        .select("id, status, display_key, thumbnail_key")
        .in("id", mediaIds)
        .eq("status", "published");

      if (mediaError) console.warn("[merchant-offers] media query failed:", mediaError.message);
      for (const media of (mediaRows ?? []) as MediaRow[]) mediaById.set(media.id, media);
    }

    const offers = rows.flatMap((row): PublicMerchantOfferFeedItem[] => {
      const partner = first(row.partners);
      const title = safeText(row.title, 160);
      const description = safeText(row.description, 2_000);
      const timezone = safeText(row.timezone, 100);
      const schedule = row.schedule === "always" || row.schedule === "weekly" ? row.schedule : null;
      if (!partner || !isVisiblePartner(partner) || !title || !description || !timezone || !schedule) return [];

      const media = row.image_media_id ? mediaById.get(row.image_media_id) : null;
      const publicUrl = (key: string | null | undefined) => key
        ? admin.storage.from(MEDIA_BUCKET).getPublicUrl(key).data.publicUrl
        : null;
      const imageUrl = publicUrl(media?.display_key);
      const thumbnailUrl = publicUrl(media?.thumbnail_key) ?? imageUrl;
      const daysOfWeek = Array.isArray(row.days_of_week)
        ? [...new Set(row.days_of_week.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
        : [];

      return [{
        id: row.id,
        partner: {
          id: partner.id,
          name: partner.name,
          slug: partner.slug,
          logoUrl: safeHttpsUrl(partner.image_url),
        },
        title,
        description,
        terms: safeText(row.terms, 4_000),
        schedule,
        daysOfWeek,
        startTime: safeTime(row.start_time),
        endTime: safeTime(row.end_time),
        startsOn: safeDate(row.starts_on),
        endsOn: safeDate(row.ends_on),
        timezone,
        remindersEnabled: row.reminders_enabled === true,
        reminderSet: false,
        imageUrl,
        thumbnailUrl,
        requiresAkibaMiles: false,
      }];
    });

    return offers
      .map((offer, index) => ({ offer, index, availability: getMerchantOfferAvailability(offer) }))
      .filter(({ availability }) => availability.state !== "ended")
      .sort((a, b) => {
        if (a.availability.state !== b.availability.state) return a.availability.state === "available" ? -1 : 1;
        return a.index - b.index;
      })
      .slice(0, safeLimit)
      .map(({ offer }) => offer);
  } catch (error) {
    console.error("[merchant-offers] public projection failed:", error);
    return [];
  }
}
