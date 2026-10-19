import { describe, expect, it } from 'vitest';

import { DEFAULT_ROUTE, notificationRouteShape, resolveNotificationRoute } from '@/push/deep-link';

describe('resolveNotificationRoute', () => {
  it('routes the links hub-page actually emits', () => {
    // These four are every deep_link the current producers set
    // (milesEarnedNotification.ts and 047/057/069's SQL producers).
    expect(resolveNotificationRoute('/vouchers/template-123')).toBe('/vouchers/purchase/template-123');
    expect(resolveNotificationRoute('/me#next-reward')).toBe('/vouchers');
    expect(resolveNotificationRoute('/me/activity')).toBe('/vouchers');
    expect(resolveNotificationRoute('/me/orders')).toBe('/vouchers');
  });

  it('keeps a merchant profile link', () => {
    expect(resolveNotificationRoute('/merchants/java-house')).toBe('/merchants/java-house');
  });

  it('ignores a query string and a fragment', () => {
    expect(resolveNotificationRoute('/me/activity?utm_source=push')).toBe('/vouchers');
    expect(resolveNotificationRoute('/vouchers/abc?x=1#y')).toBe('/vouchers/purchase/abc');
  });

  it('tolerates a trailing slash', () => {
    expect(resolveNotificationRoute('/me/activity/')).toBe('/vouchers');
  });

  it.each([
    // Not a path at all.
    'https://evil.example/phish',
    'akiba://merchants/x',
    'javascript:alert(1)',
    // Protocol-relative: a URL wearing a path's clothes.
    '//evil.example/phish',
    // Relative, so it would resolve against whatever screen is showing.
    'merchants/x',
    '../../etc/passwd',
  ])('refuses %o and falls back to Explore', (link) => {
    expect(resolveNotificationRoute(link)).toBe(DEFAULT_ROUTE);
  });

  it.each([null, undefined, 42, {}, [], ''])('falls back for a non-link value %o', (value) => {
    expect(resolveNotificationRoute(value)).toBe(DEFAULT_ROUTE);
  });

  it('falls back for a known prefix with an unroutable id', () => {
    // A path-traversal attempt inside an id segment must not be interpolated
    // into a route.
    expect(resolveNotificationRoute('/vouchers/../../secrets')).toBe(DEFAULT_ROUTE);
    expect(resolveNotificationRoute('/vouchers/a b')).toBe(DEFAULT_ROUTE);
    expect(resolveNotificationRoute(`/vouchers/${'x'.repeat(65)}`)).toBe(DEFAULT_ROUTE);
  });

  it('falls back for a route the app does not have', () => {
    // Games are deliberately excluded from native, and an unknown web
    // surface must never become a navigation target.
    expect(resolveNotificationRoute('/games/crackpot')).toBe(DEFAULT_ROUTE);
    expect(resolveNotificationRoute('/referrals')).toBe(DEFAULT_ROUTE);
    expect(resolveNotificationRoute('/vouchers/a/b/c')).toBe(DEFAULT_ROUTE);
  });

  it('only ever returns a route, never the input', () => {
    // The guarantee the whitelist exists for: no caller can be handed an
    // arbitrary string to push at the router.
    const allowed = new Set(['/', '/vouchers', '/pass', '/merchants']);
    for (const link of ['/anything', '/me', '/pass', '/merchants', '//x', 'nonsense']) {
      const route = resolveNotificationRoute(link);
      const isParameterised = /^\/(vouchers\/purchase|merchants)\/[A-Za-z0-9_-]+$/.test(route);
      expect(allowed.has(route) || isParameterised).toBe(true);
    }
  });
});

describe('notificationRouteShape', () => {
  it('collapses an id so analytics never receives a voucher template id', () => {
    // AKIBA-MOB-002 §14 bars voucher ids from events, and scrubProps cannot
    // catch one embedded in a path.
    expect(notificationRouteShape('/vouchers/purchase/template-123')).toBe('/vouchers/purchase/:id');
    expect(notificationRouteShape('/merchants/java-house')).toBe('/merchants/:id');
  });

  it('leaves an id-free route alone', () => {
    expect(notificationRouteShape('/vouchers')).toBe('/vouchers');
    expect(notificationRouteShape('/pass')).toBe('/pass');
    expect(notificationRouteShape('/')).toBe('/');
  });
});
