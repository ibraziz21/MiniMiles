# Spec: Merchant Directory and In-Store Discovery

**Primary surface:** `packages/hub-page`  
**Supporting surfaces:** Akiba Platform shared Supabase schema,
`packages/dashboard-merchant` authoring, admin moderation  
**Status:** Ready for review  
**Product direction:** Merchant/network-first; storefront commerce is an
optional capability within a merchant profile

---

## 0. Product truth and outcome

Hub currently presents an online storefront directory:

- only merchants with `partner_settings.store_active = true` are listed;
- a merchant's “categories” are inferred from its active online products;
- `delivery_cities` are displayed as if they describe physical presence;
- the merchant detail page leads with purchasable products;
- a merchant without an online catalog is effectively invisible.

That is the wrong model for a loyalty network. A merchant can be an important
AkibaMiles earn/redeem destination without selling anything through Hub.
Delivery coverage is not a branch address, and a product catalog category is
not the merchant's business category.

The outcome:

> Hub becomes the reliable place to discover where AkibaMiles members can
> visit, what each merchant is known for, which branches exist, how to contact
> them, and which vouchers they offer. Online shopping remains available where
> supported, but no longer defines directory membership.

The primary user question changes from:

> “What can I buy online?”

to:

> “Which AkibaMiles merchants can I visit, what do they offer, and what can I
> redeem there?”

## 1. Non-negotiable principles

1. **Directory visibility is independent of storefront availability.**
   `directory_status` and `store_active` are separate controls.
2. **Merchant category is explicit.** Never infer it from
   `merchant_products.category`.
3. **Branches are structured locations.** Never present
   `delivery_cities` as physical locations.
4. **Core offerings are not storefront SKUs.** A merchant can say “Tyres,
   wheel alignment, batteries” without publishing priced products.
5. **Public contacts are explicit.** Internal account, support, staff, wallet,
   and payout details are never exposed by inference.
6. **Every public profile is attributable to an active, approved merchant.**
7. **Vouchers shown on a merchant page use the same availability rules as the
   voucher catalog.** An active flag alone is insufficient.
8. **Location permission is optional.** The directory works by category and
   city without it.
9. **No hidden paid ranking.** Sponsored placement, if introduced later, must
   be visibly labelled.
10. **The directory is public and shareable.** Browsing merchants does not
    require a Hub account; voucher purchase still does.

## 2. Scope

### Phase 1

- Canonical `/merchants` directory.
- Controlled merchant category taxonomy.
- Search and filters by merchant name, category, city/locality, and core
  offering.
- Optional “Near me” sorting when the user grants location permission.
- Merchant detail page with:
  - description and categories;
  - exact location and branches;
  - opening hours;
  - core product/service lines;
  - currently available vouchers;
  - public phone, email, WhatsApp, website, and social links;
  - optional online storefront section.
- Merchant/admin data-entry and validation contract.
- Directions, call, WhatsApp, voucher and online-shop analytics.
- Backward-compatible redirects from `/shop`.

### Deferred

- Reviews and ratings.
- User-submitted location corrections.
- Reservations or appointments.
- Live stock by branch.
- Branch-specific product inventory.
- Sponsored ranking.
- Geofenced push notifications.
- Background location collection.
- “Visited” claims based solely on GPS.
- Full map-first browsing.

Stable branch IDs are introduced now so future scans, awards, redemptions and
transactions can be attributed to a branch without replacing the directory
model.

## 3. Terminology and concept separation

| Concept | Meaning | Source of truth |
|---|---|---|
| Partner | Akiba Platform organization/account | `partners` |
| Directory merchant | Approved merchant visible to members | `partners.status` + `partner_settings.directory_status` |
| Merchant category | Business vertical such as Food & Drink | `merchant_categories` + assignments |
| Core offering | Human-readable product/service family, no price or inventory | `merchant_core_offerings` |
| Branch/location | A visitable physical location or explicitly online-only presence | `merchant_locations` |
| Delivery coverage | Cities to which online orders can be delivered | existing `partner_settings.delivery_cities` |
| Storefront product | Priced item purchasable through Hub | existing `merchant_products` |
| Voucher | AkibaMiles offer issued from an available voucher program | existing voucher platform |
| Public contact | Contact intentionally published to members | explicit public profile fields |
| Internal contact | Staff/account/operations contact | never returned by public directory APIs |

The first implementation task is to make these distinctions visible in names,
types, queries, and UI copy.

## 4. Routes and navigation

### Canonical routes

- `/merchants` — merchant directory.
- `/merchants/[slug]` — merchant profile.

Update desktop and mobile navigation from “Shop & Earn” / “Shop” to
“Merchants”.

### Backward compatibility

- `/shop` permanently redirects to `/merchants`.
- `/shop/[slug]` permanently redirects to `/merchants/[slug]`.
- Existing `/api/shop/*` transactional endpoints remain unchanged. Renaming
  checkout APIs provides no user value and creates unnecessary risk.
- Existing read endpoints `/api/shop/merchants` and
  `/api/shop/merchants/[slug]` become deprecated compatibility adapters over
  the new public read service for one release window; they must not retain
  the old `store_active`-only logic.
- Existing voucher and home-page links migrate to `/merchants/[slug]`.

Preserve query parameters where meaningful during redirects.

### Storefront placement

The merchant profile contains an “Shop online” section/tab only when:

- `partner_settings.store_active = true`; and
- at least one active `merchant_products` row exists.

The default merchant page remains “Overview”, never the storefront.

## 5. Category taxonomy

`merchant_products.category` describes an online SKU. It must not be reused as
a merchant business category because merchants without online products would
remain uncategorized and multi-line businesses would be misrepresented.

### Initial controlled taxonomy

| Slug | Display name |
|---|---|
| `food_drink` | Food & Drink |
| `groceries_everyday` | Groceries & Everyday Retail |
| `fashion_accessories` | Fashion & Accessories |
| `beauty_wellness` | Beauty & Wellness |
| `health_pharmacy` | Health & Pharmacy |
| `electronics_appliances` | Electronics & Appliances |
| `home_living` | Home & Living |
| `automotive_mobility` | Automotive & Mobility |
| `travel_hospitality` | Travel & Hospitality |
| `entertainment_leisure` | Entertainment & Leisure |
| `professional_services` | Professional Services |
| `education_learning` | Education & Learning |

Do not seed a “General” category. It becomes a permanent dumping ground and
provides no discovery value. Administrators can add a category through
controlled data changes when a real merchant does not fit.

### Assignment rules

- One primary category is required for publication.
- Up to three active categories per merchant.
- Exactly one active assignment is primary.
- Category slugs are immutable after launch; display names may change.
- Merchant owners/managers may select categories; admin can correct them.
- Category changes are audit logged.

## 6. Existing fields to reuse

The shared Platform `partners` schema already includes:

- `description`, `short_description`;
- `logo_url`, `banner_url`;
- `website_url`;
- `support_email`;
- `country`, `city`;
- `type`, `status`, `slug`, `name`.

These remain the canonical brand-level fields. Do not introduce another
`merchant_profiles` table containing duplicates.

Merchant onboarding already writes these fields to `partner_settings`:

- `business_category`;
- `store_presence` (`physical`, `online`, or `both`);
- `physical_address`;
- `website_url`;
- `support_email` and `support_phone`.

They must be incorporated into the directory migration rather than shadowed
by a second set of profile fields:

- `store_presence` remains the persisted source of truth. Public DTOs map
  `both` to the friendlier `hybrid` label.
- `business_category` is a legacy, single free-text/onboarding choice. It
  seeds category assignments for review, then becomes deprecated once every
  merchant has controlled assignments.
- `physical_address` may seed a draft primary branch, but it is never enough
  to publish. A merchant or admin must split it into the structured location
  fields, confirm it is a public business address, and add a map point or URL
  where possible.
- `partner_settings.website_url` is backfilled into
  `partners.website_url` where the latter is empty. The onboarding write path
  then moves to `partners.website_url`; the settings copy becomes deprecated.
- existing support email/phone values are private-by-default migration
  suggestions. They are not copied to public contact fields until the
  merchant explicitly confirms publication.

Migration/backfill rules:

- `partners.logo_url` becomes canonical; existing `partner_settings.logo_url`
  and legacy `partners.image_url` are fallbacks during migration only.
- `partners.short_description` is the directory-card summary.
- `partners.description` is the full About copy.
- `partners.website_url` is the published website.
- `partners.support_email` is not automatically public. Existing data must be
  explicitly confirmed before copying to `public_email`.
- `partners.city` is the merchant's general/head-office city, not a branch.

## 7. Data model

The schema is shared with Akiba Platform. Its migration chain is the
authoritative DDL owner; do not recreate these tables in dashboard-local SQL.
Hub and dashboards consume the same objects.

### 7.1 `partner_settings` additions

```sql
alter table partner_settings
  add column directory_status text not null default 'draft'
    check (directory_status in (
      'draft', 'pending_review', 'published',
      'changes_requested', 'paused', 'suspended'
    )),
  add column directory_submitted_at timestamptz,
  add column directory_published_at timestamptz,
  add column public_email text,
  add column public_phone text,
  add column public_whatsapp text,
  add column instagram_url text,
  add column facebook_url text,
  add column directory_updated_at timestamptz;
```

Meaning:

- `directory_status`: member-facing publication and moderation lifecycle.
- `store_active`: online checkout capability only.
- public contact fields are intentional publication choices.

A merchant is visible only when:

```text
partners.type = 'merchant'
AND partners.status = 'active'
AND partner_settings.directory_status = 'published'
AND merchant profile completeness passes
```

Pausing `store_active` does not hide the merchant, its branches, or its
vouchers. Suspending `partners.status` hides the profile regardless of other
settings.

### 7.2 `merchant_categories`

```sql
create table merchant_categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  icon_key      text,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### 7.3 `merchant_category_assignments`

```sql
create table merchant_category_assignments (
  partner_id    uuid not null references partners(id) on delete cascade,
  category_id   uuid not null references merchant_categories(id),
  is_primary    boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (partner_id, category_id)
);

create unique index uq_merchant_primary_category
  on merchant_category_assignments(partner_id)
  where is_primary = true;
```

Enforce the three-category maximum in the write RPC, where a useful error can
be returned. The publication validator enforces that a primary assignment
exists.

### 7.4 `merchant_core_offerings`

Core offerings are short labels such as:

- “Fresh pastries and celebration cakes”
- “Tyres and wheel alignment”
- “Haircuts, braiding and colouring”
- “Phones, laptops and accessories”

They are not carts, SKUs, stock or prices.

```sql
create table merchant_core_offerings (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partners(id) on delete cascade,
  name          text not null,
  description   text,
  display_order integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_merchant_core_offerings_partner
  on merchant_core_offerings(partner_id, active, display_order);
```

Validation:

- 1–20 active offerings for a published profile.
- Name: 2–80 characters.
- Description: optional, maximum 240 characters.
- Duplicate normalized names rejected per merchant.

### 7.5 `merchant_locations`

One row represents one public branch or visitable business location.

```sql
create table merchant_locations (
  id                    uuid primary key default gen_random_uuid(),
  partner_id            uuid not null references partners(id) on delete cascade,
  name                  text not null,
  location_type         text not null default 'store'
                          check (location_type in (
                            'store', 'office', 'pickup_point', 'service_centre'
                          )),
  address_line_1        text not null,
  address_line_2        text,
  building              text,
  floor_or_unit         text,
  landmark              text,
  locality              text,
  city                  text not null,
  county_or_region      text,
  postal_code           text,
  country_code          text not null default 'KE',
  latitude              numeric(9,6),
  longitude             numeric(9,6),
  maps_url              text,
  public_phone          text,
  public_email          text,
  public_whatsapp       text,
  timezone              text not null default 'Africa/Nairobi',
  opening_hours         jsonb not null default '{}'::jsonb,
  is_primary            boolean not null default false,
  accepts_akiba_pass    boolean not null default true,
  accepts_vouchers      boolean not null default true,
  active                boolean not null default true,
  display_order         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (
    (latitude is null and longitude is null)
    or
    (
      latitude is not null
      and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

create unique index uq_merchant_primary_location
  on merchant_locations(partner_id)
  where is_primary = true and active = true;

create index idx_merchant_locations_discovery
  on merchant_locations(city, locality)
  where active = true;
```

Location requirements:

- `address_line_1` must contain a real street/building/place description, not
  only a city name.
- At least one of coordinates or a verified map URL is strongly required for
  physical/hybrid merchants and mandatory before “Near me” eligibility.
- Phone/WhatsApp values normalize to E.164.
- URLs use HTTPS.
- Only public business addresses may be entered.
- One active location must be marked primary.

If a merchant has only one location, the UI labels it “Visit us” rather than
“Branches”. With multiple locations, it becomes “Branches”.

Online-only merchants are represented by the existing
`partner_settings.store_presence` field, not a fake location:

- `physical` → public `operatingModel: "physical"`;
- `both` → public `operatingModel: "hybrid"`;
- `online` → public `operatingModel: "online"`.

Do not introduce a competing `operating_model` database column. Physical and
hybrid merchants require a primary location to publish. Online merchants
require a website and no branch.

### 7.6 Opening-hours contract

`opening_hours` uses a versioned, validated structure:

```json
{
  "version": 1,
  "monday": [{ "opens": "08:00", "closes": "18:00" }],
  "tuesday": [{ "opens": "08:00", "closes": "18:00" }],
  "wednesday": [{ "opens": "08:00", "closes": "18:00" }],
  "thursday": [{ "opens": "08:00", "closes": "18:00" }],
  "friday": [{ "opens": "08:00", "closes": "18:00" }],
  "saturday": [{ "opens": "09:00", "closes": "15:00" }],
  "sunday": [],
  "notes": "Closed on public holidays"
}
```

Rules:

- Times are local to the location's IANA timezone.
- Empty array means closed.
- Multiple ranges support a midday closure.
- “Open now” is calculated by a shared tested helper, not independently by
  list and detail components.
- Free-form notes supplement structured hours but never replace them.

### 7.7 Branch-specific voucher availability

Add an optional restriction table:

```sql
create table voucher_template_locations (
  template_id uuid not null references spend_voucher_templates(id) on delete cascade,
  location_id uuid not null references merchant_locations(id) on delete cascade,
  primary key (template_id, location_id)
);
```

Semantics:

- No rows for a template means all active voucher-accepting branches.
- One or more rows means only those branches.
- A location must belong to the voucher template's partner.
- The merchant page states “Available at all branches” or lists applicable
  branches.

Do not require merchants to create restrictions for ordinary all-branch
vouchers.

### 7.8 Future branch attribution

Do not block Phase 1 on transaction changes, but preserve
`merchant_locations.id` for later optional foreign keys:

- `merchant_transactions.merchant_location_id`;
- `voucher_redemptions.merchant_location_id`;
- scan/award event metadata;
- merchant staff default location.

Directions clicks are only a footfall-intent proxy. Actual branch footfall
must eventually come from a verified scan, award, redemption or transaction,
not GPS assumptions.

## 8. Public read model

Hub must not build public DTOs by selecting `partners.*`,
`partner_settings.*` or `partner_contacts.*`. Those tables contain internal
and financial fields.

Create public-safe database views or narrowly scoped RPCs:

- `list_public_merchants(...)`
- `get_public_merchant(p_slug text, p_hub_user_id uuid default null)`

They return only allowlisted directory fields.

### Directory result

```ts
type PublicMerchantSummary = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  logoUrl: string | null;
  primaryCategory: { slug: string; name: string };
  categories: Array<{ slug: string; name: string }>;
  operatingModel: "physical" | "hybrid" | "online";
  primaryLocation: {
    id: string;
    locality: string | null;
    city: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  branchCount: number;
  voucherCount: number;
  storeActive: boolean;
  distanceKm: number | null;
};
```

### Merchant detail result

```ts
type PublicMerchantDetail = PublicMerchantSummary & {
  description: string;
  bannerUrl: string | null;
  websiteUrl: string | null;
  contacts: {
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
  };
  locations: PublicMerchantLocation[];
  coreOfferings: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  vouchers: PublicVoucherSummary[];
  products: PublicStorefrontProduct[];
};
```

Never return:

- wallet or payout addresses;
- internal/support contacts not explicitly marked public;
- staff names and contacts;
- private notes;
- merchant subscription/billing information;
- inactive branches or products;
- raw cap/inventory internals unnecessary for the UI.

## 9. Voucher correctness

The current merchant page selects templates using `active = true`, which can
show expired, exhausted, ambiguous-program or otherwise unavailable offers.

The new detail read must reuse the canonical voucher availability logic:

- template active and not expired;
- exactly one eligible active `miles_purchase` program;
- program and channel caps not exhausted;
- global cap not exhausted;
- hidden/test partners excluded;
- signed-in user cooldown applied when a Hub user is known.

Anonymous visitors may see generally available offers. After sign-in, the
same card refreshes against user-specific cooldown/availability.

Voucher cards show:

- offer title and value;
- Miles cost;
- applicable product/category;
- expiration where relevant;
- applicable branches;
- “Sign in to get voucher”, “Get voucher”, “Processing”, or a truthful
  unavailable state.

The merchant page calls the same quote/redeem flow as `/vouchers`; it must not
create a second issuance path.

## 10. Directory page UX

### Page identity

Title: **Merchants**  
Description: **Find places to earn and use AkibaMiles—near you and online.**

The existing commerce “How it works” strip is removed from the top of this
page. Online checkout education belongs inside merchants that have a store.

### Content order

1. Search.
2. “Near me” control and city selector.
3. Browse-by-category chips/cards.
4. Merchant results.

### Search

Search matches:

- merchant name;
- primary and secondary category names;
- core offering names;
- city, locality and branch name.

Do not search internal contacts or storefront descriptions.

As the network grows, move search from loading every merchant into a client
component to the server RPC with cursor pagination. The initial API contract
starts server-side so this migration does not require another rewrite.

### Merchant card

Each card prioritizes:

1. logo and merchant name;
2. primary category plus optional secondary chips;
3. nearest or primary branch locality/city;
4. branch count where greater than one;
5. “Open now” when reliable hours exist;
6. available-voucher count;
7. badges: `In store`, `Online`, or both.

Do not lead with:

- online product count;
- delivery cities;
- checkout payment rails;
- “Shop” as the only CTA.

CTA: **View merchant**.

### Sorting

- With user coordinates: nearest first, then name.
- With selected city: matching locality/city, then name.
- Without either: primary category sort order, then merchant name.
- Search results: relevance, then distance/name.
- Admin-configured featured ranking is deferred.

“Near me” requests browser geolocation only after the user taps it. Coordinates
are used for the current query and not stored in the user's profile or
analytics.

## 11. Merchant detail UX

### Header

- banner and logo;
- merchant name;
- verified AkibaMiles merchant indicator;
- primary and secondary category chips;
- short description;
- operating badges: in-store / online;
- primary actions:
  - **Directions** for physical/hybrid merchant;
  - **Call** or **WhatsApp** where available;
  - **View vouchers** when offers exist.

On mobile, Directions / Contact / Vouchers may use a compact sticky action
bar. Do not obscure the global navigation or Pass action.

### Default Overview content

1. **Visit us / Branches**
   - branch name;
   - specific formatted address;
   - landmark/building/unit;
   - Open now / Closed plus today's hours;
   - branch phone/WhatsApp;
   - accepts Akiba Pass/vouchers indicators;
   - directions link.
2. **What they offer**
   - core offerings list independent of the online store.
3. **About**
   - merchant description.
4. **Vouchers**
   - available offers and applicable branches.
5. **Contact**
   - public phone, WhatsApp, email, website and social links.
6. **Shop online**
   - shown after the directory content when active.

Desktop may use sections with a sticky summary/action column. Mobile uses a
single readable flow. Tabs are acceptable for Vouchers and Shop online, but
the location and core-offering information must remain on the default view.

### Directions

Phase 1 does not embed a paid map SDK. “Directions” opens a maps URL built
from:

1. verified `maps_url`, when supplied; otherwise
2. latitude/longitude; otherwise
3. the fully formatted address.

Open the link in the device's available mapping experience. Always keep the
text address visible for users who do not want to leave Hub.

### Missing data

- No location for a physical merchant: profile cannot publish.
- No hours: show no Open/Closed claim; display “Hours not provided”.
- No contact: omit the action rather than showing placeholders.
- No vouchers: omit the voucher CTA/section.
- Store inactive: keep directory profile visible; omit Shop online.
- Temporarily closed branch: set branch inactive or add a clearly modelled
  temporary-closure status later; do not delete historical IDs.

## 12. API contracts

### `GET /api/merchants`

Query:

- `q`
- `category`
- `city`
- `lat`, `lng`
- `radius_km`
- `mode=physical|online|all`
- `cursor`
- `limit` capped at 50

Response:

```json
{
  "merchants": [],
  "next_cursor": null,
  "applied": {
    "category": null,
    "city": null,
    "nearby": false
  }
}
```

Validate coordinate ranges and cap radius. Do not log raw coordinates.

### `GET /api/merchants/[slug]`

Returns `PublicMerchantDetail`, with:

- public profile;
- active locations;
- core offerings;
- generally/user-available vouchers;
- storefront products only when store is active.

Use `Cache-Control`/Next revalidation appropriate for public data, but do not
cache a signed-in user's cooldown-specific voucher state into an anonymous
response. Split public profile caching from user-specific voucher eligibility
if necessary.

### Authoring routes

Merchant owner/manager routes:

- `PATCH /api/merchant/directory/profile`
- `PUT /api/merchant/directory/categories`
- `POST /api/merchant/directory/locations`
- `PATCH|DELETE /api/merchant/directory/locations/[id]`
- `POST /api/merchant/directory/offerings`
- `PATCH|DELETE /api/merchant/directory/offerings/[id]`
- `POST /api/merchant/directory/submit`

Every write:

- derives partner ID from the authenticated merchant session;
- checks owner/manager role;
- uses allowlisted fields;
- normalizes contacts/URLs;
- writes the existing merchant audit log;
- never accepts a caller-supplied partner ID.

Admin routes can publish, suspend and correct categories. Akiba Platform's
`packages/dashboard-merchant` is the canonical authoring owner because it
already owns merchant onboarding and writes the shared Platform schema. Do
not build another directory editor in MiniMiles'
`packages/merchant-dashboard`. If that older dashboard remains deployed
during transition, it links merchants to the canonical editor; all other
surfaces read the shared schema.

## 13. Publication workflow and completeness

### Workflow

```text
draft → pending_review → published
                       → changes_requested
published → paused
published → suspended (admin)
```

`partner_settings.directory_status` owns this workflow;
`partners.status` continues to represent organization approval. Only
`published` is public. `suspended` is admin-controlled, while a merchant may
pause its own directory presence. A merchant can move
`changes_requested → draft → pending_review` and `paused → published`;
only an admin can move a profile into or out of `suspended`. Enforce allowed
transitions in one write service/RPC rather than letting each UI mutate the
status independently.

### Publish gate

`validate_merchant_directory_profile(partner_id)` returns structured missing
fields. Publication requires:

- active merchant partner;
- name and slug;
- short description and full description;
- logo;
- one primary category;
- 1–20 core offerings;
- valid `store_presence`;
- for physical/hybrid: one primary active location with specific address;
- for online: website URL;
- at least one explicit public contact method;
- no invalid URLs, phones or opening-hour ranges.

Admin can see completeness but cannot bypass it silently. An emergency
override requires a reason in the audit log.

After initial publication, merchants may update hours, contacts, locations
and offerings immediately, with audit history. Admin may suspend misleading
or unsafe profiles.

## 14. Security, privacy and trust

- Public DTOs are allowlists, never `select("*")`.
- Do not expose checkout wallet address on a public merchant profile.
- `partner_contacts` is internal and must never feed public contact cards.
- Merchant branch addresses must be business locations, not home addresses.
- Merchant confirms permission to publish every phone/email/address.
- Sanitize and validate URLs; reject `javascript:`, data URLs and protocol
  relative URLs.
- Contact links use `tel:`, `mailto:` and safe HTTPS WhatsApp links.
- User coordinates are ephemeral and excluded from logs.
- Service-role public routes still enforce directory eligibility.
- Hidden/test merchant logic is replaced over time by explicit partner status
  and directory state, but remains as a transitional defense.
- RLS/service routes scope authoring to the authenticated merchant.
- Admin publish/suspend and merchant edits are audit logged.

## 15. Analytics and footfall measurement

Phase 1 events:

- `merchant_directory_view`
- `merchant_search`
- `merchant_category_filter`
- `merchant_city_filter`
- `merchant_near_me_enable`
- `merchant_profile_view`
- `merchant_directions_tap`
- `merchant_call_tap`
- `merchant_whatsapp_tap`
- `merchant_website_tap`
- `merchant_voucher_view`
- `merchant_voucher_redeem_start`
- `merchant_shop_online_view`
- `merchant_product_add_to_cart`

Event properties use merchant ID, category slug and branch ID where relevant.
Do not send raw query text, coordinates, phone numbers, emails or addresses.

Interpretation:

- directory/profile views = discovery;
- directions/call/WhatsApp = visit intent;
- pass scans, awards, voucher redemptions and purchases = verified activity;
- only verified activity should be reported to merchants as actual footfall or
  conversion.

The future branch-attribution fields in §7.8 close the loop from discovery to
in-store behavior.

## 16. SEO, sharing and accessibility

- Merchant profiles have canonical `/merchants/[slug]` URLs.
- Generate title/description/Open Graph data from approved public content.
- Add merchant pages to the public sitemap.
- Emit `LocalBusiness` JSON-LD for physical branches using only validated
  public details.
- Redirect old `/shop` URLs without creating duplicate indexed content.
- Category and merchant cards are keyboard accessible.
- Do not encode information using colour alone.
- Phone, email and direction links have descriptive accessible labels.
- Branch accordions expose correct expanded state.
- “Open now” always includes readable hours.

## 17. Migration and launch

### Data preparation

1. Add schema and seed the controlled categories.
2. Convert existing onboarding data into reviewable drafts:
   - map `restaurant` and `cafe` to `food_drink`;
   - map `grocery` to `groceries_everyday`;
   - map `salon_spa` and `fitness` to `beauty_wellness`;
   - map `electronics` to `electronics_appliances`;
   - map `fashion` to `fashion_accessories`;
   - map `pharmacy` to `health_pharmacy`;
   - map `services` to `professional_services`;
   - leave `retail`, `other`, unknown and empty values for manual
     classification because an automatic choice would be misleading.
3. Use `store_presence` directly; do not create another operating-model
   field.
4. Turn `physical_address` into an unpublished primary-location draft for
   physical/both merchants. Require structured-address confirmation before
   publication.
5. Backfill `partners.website_url` from `partner_settings.website_url` only
   when the canonical field is empty, then update onboarding to write the
   canonical field.
6. Create additional draft category suggestions from existing product
   categories, but do not publish them automatically; a product category is
   weak evidence.
7. Copy reusable partner descriptions/branding into the authoring workflow.
8. Treat `delivery_cities` only as delivery data; never backfill branches from
   it.
9. Ask each current merchant to confirm:
   - categories;
   - core offerings;
   - which support contacts, if any, may be public;
   - store presence;
   - branch addresses, coordinates and hours;
   - voucher branch applicability.
10. Admin reviews and publishes profiles.

### No-disappearance rollout

Do not switch navigation until existing live merchants have directory
profiles. Roll out behind a feature flag:

1. schema and authoring;
2. internal preview;
3. profile completion for current merchants;
4. `/merchants` available by direct link;
5. old/new result comparison;
6. navigation switch and `/shop` redirects;
7. remove legacy category/location fallbacks after the migration window.

Never automatically publish a placeholder profile merely to preserve a card.
It is better to delay the navigation switch than launch inaccurate location
data.

## 18. Verification

### Unit

- category and contact normalization;
- formatted address;
- opening-hours/Open-now calculation across timezones and overnight ranges;
- distance calculation and coordinate validation;
- profile completeness;
- public DTO field allowlist;
- storefront/directory state combinations;
- safe directions URL generation.

### Route

- inactive/draft/suspended merchant returns 404;
- published store-inactive merchant remains visible;
- store-active merchant with products exposes Shop online;
- product categories do not become merchant categories;
- delivery cities do not become branches;
- filters/search/pagination are deterministic;
- location coordinates are optional except for Nearby eligibility;
- public APIs never expose wallet, payout or internal contacts;
- merchant cannot edit another partner;
- staff cannot perform owner/manager directory writes;
- unknown fields are ignored/rejected;
- user-specific voucher cooldown is not leaked through shared cache.

### PostgreSQL integration

- one primary category per merchant;
- no more than three categories through write RPC;
- one active primary branch;
- voucher/location ownership invariant;
- publish validator reports every missing requirement;
- suspended partner disappears even if directory flag remains true;
- online-only merchant publishes without a branch but requires website;
- public view contains only active branches/offerings/categories;
- category/location deletion behavior preserves referential integrity.

### Acceptance journeys

1. User opens Merchants, selects Food & Drink, and sees merchant cards with
   category and location rather than product counts.
2. User taps Near me, grants permission, and results order by distance without
   storing coordinates.
3. User opens a physical merchant and can see exact address, branches, hours,
   core offerings, vouchers and contacts without encountering a storefront
   first.
4. User taps Directions for a selected branch and the mapping experience
   receives the correct destination.
5. User opens an in-store-only merchant with `store_active = false`; the
   profile works and contains no Shop online section.
6. User opens a hybrid merchant and can choose between visiting, getting a
   voucher and shopping online.
7. Merchant updates Saturday hours and the public profile reflects the
   audited change after cache revalidation.
8. Admin suspends a merchant and every public directory/detail read fails
   closed.

## 19. Definition of done

- Merchant directory membership no longer depends on an online store.
- Every public merchant has one controlled primary business category.
- Every physical/hybrid merchant exposes at least one specific branch.
- Core offerings exist independently of priced storefront products.
- Merchant profile shows available vouchers using canonical availability.
- Contacts are explicit and public-safe.
- Storefront content is secondary and conditionally displayed.
- Old `/shop` links remain functional through redirects.
- No delivery city is represented as a branch.
- No wallet, payout or internal contact appears in public responses.
- Search, filters, nearby sorting and directions work on mobile.
- Merchant/admin authoring, validation and audit flows exist.
- Automated tests and the eight acceptance journeys pass.

## 20. Implementation order

1. Akiba Platform shared migration: directory lifecycle, categories,
   locations, offerings, voucher-location restrictions, onboarding-field
   migration and public-safe read functions.
2. Seed taxonomy and build profile completeness validation.
3. Extend Akiba Platform `packages/dashboard-merchant` onboarding/settings
   and admin moderation; do not duplicate authoring in Hub.
4. Populate and review current merchant data.
5. Hub public APIs and typed DTOs.
6. `/merchants` directory, category/city/nearby search.
7. Merchant Overview, branches, offerings, vouchers and contacts.
8. Conditional Shop online section using existing cart/checkout.
9. Analytics, SEO, accessibility and tests.
10. Preview, current-merchant completion, navigation cutover and redirects.
