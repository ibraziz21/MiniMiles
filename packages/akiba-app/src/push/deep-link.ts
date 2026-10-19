/**
 * Maps a notification's `deep_link` onto a native route.
 *
 * The links are authored for the web Hub (hub-page's producers emit
 * `/vouchers/<templateId>`, `/me#next-reward`, `/me/activity`,
 * `/me/orders`), so native cannot simply push them at the router — several
 * have no native screen at all, and the app's routes are differently shaped
 * (`/vouchers/purchase/<templateId>` rather than `/vouchers/<templateId>`).
 *
 * Deliberately a whitelist rather than a sanitiser. The value arrives from
 * the server inside a push payload, and the only routes it can produce are
 * the ones named below — so a malformed, unexpected or hostile value can
 * land on Explore at worst, never on an arbitrary route and never on an
 * external URL. A `deep_link` is data, not an instruction.
 *
 * Pure on purpose: every case below is unit-tested without a device.
 */

/** Where a notification with no usable link goes. */
export const DEFAULT_ROUTE = '/';

const STATIC_ROUTES: Record<string, string> = {
  // The Miles ledger and the order history have no native screen; Rewards is
  // the nearest surface that answers "what did my Miles do", and it is where
  // the next-reward progress lives.
  '/me/activity': '/vouchers',
  '/me/orders': '/vouchers',
  '/me': '/vouchers',
  '/my-vouchers': '/vouchers',
  '/pass': '/pass',
  '/merchants': '/merchants',
};

// A catalogue template id. Deliberately strict: anything else is not an id
// this app can route to, so it falls back rather than being interpolated.
const ID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveNotificationRoute(deepLink: unknown): string {
  if (typeof deepLink !== 'string') return DEFAULT_ROUTE;

  const trimmed = deepLink.trim();
  // Must be a site-relative path. Rejecting `//host` matters: it is a
  // protocol-relative URL, not a path.
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_ROUTE;

  // Drop the fragment and query — `/me#next-reward` is the same destination
  // as `/me` for routing purposes.
  const path = trimmed.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';

  if (path === '/') return DEFAULT_ROUTE;

  const staticMatch = STATIC_ROUTES[path];
  if (staticMatch) return staticMatch;

  const segments = path.slice(1).split('/');

  // /vouchers/<templateId> — the web catalogue item. Natively this is the
  // purchase screen, which is what `getNextRewardSummary` points at when the
  // member can already afford the reward.
  if (segments.length === 2 && segments[0] === 'vouchers' && ID_SEGMENT.test(segments[1])) {
    return `/vouchers/purchase/${segments[1]}`;
  }

  // /merchants/<slug> — merchant profile, same shape on both sides.
  if (segments.length === 2 && segments[0] === 'merchants' && ID_SEGMENT.test(segments[1])) {
    return `/merchants/${segments[1]}`;
  }

  return DEFAULT_ROUTE;
}

/**
 * The route with its id segments collapsed — `/vouchers/purchase/:id`
 * rather than `/vouchers/purchase/abc123`.
 *
 * This is what analytics records. AKIBA-MOB-002 §14 bars voucher ids from
 * events, and scrubProps cannot catch one embedded in a path (it is not a
 * blocked key, and a value with slashes does not match its opaque-token
 * shape), so the id is dropped here instead of relying on the scrubber to
 * notice it.
 */
export function notificationRouteShape(route: string): string {
  const segments = route.split('/');
  if (segments.length < 2) return route;
  return segments
    .map((segment, index) => (index > 0 && ID_SEGMENT.test(segment) && !KNOWN_SEGMENTS.has(segment) ? ':id' : segment))
    .join('/');
}

// Path segments that are part of a route rather than an identifier, so they
// survive the collapse above.
const KNOWN_SEGMENTS = new Set(['vouchers', 'purchase', 'loyalty', 'funded', 'merchants', 'pass', 'profile', 'offers', 'gifts']);
