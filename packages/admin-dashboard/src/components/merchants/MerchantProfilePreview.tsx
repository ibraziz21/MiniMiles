import Link from "next/link";
import { ArrowLeft, ExternalLink, MapPin, Phone, Store } from "lucide-react";
import { openingHoursRows, safePublicUrl } from "@/lib/reviewPresentation";

type Location = {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  building: string | null;
  floorOrUnit: string | null;
  locality: string | null;
  city: string | null;
  countyOrRegion: string | null;
  countryCode: string | null;
  mapsUrl: string | null;
  openingHours: unknown;
  publicPhone: string | null;
  timezone: string | null;
  isPrimary: boolean;
};
type PreviewData = {
  name: string;
  description: string | null;
  shortDescription: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  primaryCategory: { name: string } | null;
  locations: Location[];
  contacts: {
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
  };
  coreOfferings: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  merchantMedia?: Array<{
    id: string;
    imageUrl: string;
    altText: string | null;
    title: string | null;
  }>;
};

export function MerchantProfilePreview({
  profile,
  reviewUrl,
}: {
  profile: PreviewData;
  reviewUrl: string;
}) {
  const cover = safePublicUrl(profile.bannerUrl);
  const primary =
    profile.locations.find((location) => location.isPrimary) ??
    profile.locations[0];
  const phone = primary?.publicPhone ?? profile.contacts.phone;
  const tel = phone?.replace(/[^+\d]/g, "");
  const website = safePublicUrl(profile.websiteUrl);
  const gallery = (profile.merchantMedia ?? []).filter((photo) =>
    safePublicUrl(photo.imageUrl)
  );
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <Link
        href={reviewUrl}
        className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to review
      </Link>
      <article className="overflow-hidden rounded-card border border-border bg-white">
        {cover ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt={`${profile.name} cover`}
              width={1200}
              height={600}
              className="aspect-[2/1] w-full object-cover"
            />
          </>
        ) : (
          <div className="flex h-28 items-center justify-center bg-primary/5">
            <Store className="h-9 w-9 text-primary" aria-hidden="true" />
          </div>
        )}
        <div className="space-y-4 p-4 sm:p-6">
          <h2 className="break-words text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {profile.name}
          </h2>
          <p className="text-sm text-ink-muted">
            {[profile.primaryCategory?.name, primary?.locality, primary?.city]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="whitespace-pre-line break-words text-base leading-relaxed text-ink-muted">
            {profile.description ??
              profile.shortDescription ??
              "No description supplied."}
          </p>
          <div className="flex flex-wrap gap-2">
            {tel && (
              <a
                href={`tel:${tel}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call business
              </a>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-4 text-sm font-medium text-primary hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Website
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </article>
      {profile.locations.map((location) => (
        <section
          key={location.id}
          className="rounded-card border border-border bg-white p-4 sm:p-5"
        >
          <div className="flex items-center gap-2">
            <MapPin
              className="h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-ink">{location.name}</h3>
          </div>
          <p className="mt-3 break-words text-base leading-relaxed text-ink-muted">
            {[
              location.addressLine1,
              location.addressLine2,
              location.building,
              location.floorOrUnit,
              location.locality,
              location.city,
              location.countyOrRegion,
              location.countryCode,
            ]
              .filter(Boolean)
              .join(", ") || "No address supplied."}
          </p>
          {safePublicUrl(location.mapsUrl) && (
            <a
              href={safePublicUrl(location.mapsUrl)!}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Open map
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          <h4 className="mt-4 font-medium text-ink">Opening hours</h4>
          <p className="mt-1 text-xs text-ink-muted">
            {location.timezone ?? "Timezone not supplied"}
          </p>
          <dl className="mt-3 space-y-2 text-sm text-ink-muted">
            {openingHoursRows(location.openingHours).map((row) => (
              <div
                key={row.day}
                className="flex flex-wrap justify-between gap-2"
              >
                <dt>{row.day}</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {row.hours}
                </dd>
              </div>
            ))}
          </dl>
          {location.publicPhone && (
            <p className="mt-3 break-words text-sm text-ink-muted">
              {location.publicPhone}
            </p>
          )}
        </section>
      ))}
      {profile.coreOfferings.length > 0 && (
        <section className="rounded-card border border-border bg-white p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-ink">What’s available</h3>
          <ul className="mt-3 divide-y divide-border">
            {profile.coreOfferings.map((item) => (
              <li key={item.id} className="py-3">
                <h4 className="break-words font-medium text-ink">
                  {item.name}
                </h4>
                {item.description && (
                  <p className="mt-1 break-words text-sm text-ink-muted">
                    {item.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {gallery.length > 0 && (
        <section>
          <h3 className="mb-3 text-lg font-semibold text-ink">Photos</h3>
          <div className="grid grid-cols-2 gap-3">
            {gallery.map((photo) => (
              <a
                key={photo.id}
                href={safePublicUrl(photo.imageUrl)!}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={safePublicUrl(photo.imageUrl)!}
                  alt={photo.altText || photo.title || `${profile.name} photo`}
                  width={480}
                  height={320}
                  loading="lazy"
                  className="aspect-[3/2] w-full object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}
      <section className="rounded-card border border-border bg-white p-4 sm:p-5">
        <h3 className="text-lg font-semibold text-ink">Contact</h3>
        <dl className="mt-3 space-y-3 text-sm">
          {Object.entries(profile.contacts)
            .filter(([, value]) => value)
            .map(([key, value]) => (
              <div key={key}>
                <dt className="capitalize text-ink-muted">{key}</dt>
                <dd className="break-words text-base text-ink">{value}</dd>
              </div>
            ))}
          {!Object.values(profile.contacts).some(Boolean) && (
            <div>
              <dt className="sr-only">Contact details</dt>
              <dd className="text-ink-muted">No public contact supplied.</dd>
            </div>
          )}
        </dl>
      </section>
      <Link
        href={reviewUrl}
        className="flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to review
      </Link>
    </div>
  );
}
