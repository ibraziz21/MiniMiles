import { describe, expect, it } from 'vitest';

import { compareVersions, resolveLaunchGate } from '@/config/version';
import type { MobileConfig } from '@/contracts';

function config(overrides: Partial<MobileConfig> = {}): MobileConfig {
  return {
    minimumSupportedVersion: { ios: '1.2.0', android: '1.2.0' },
    latestVersion: { ios: '1.5.0', android: '1.5.0' },
    maintenance: false,
    features: {
      walletLinking: false,
      offlinePass: true,
      hubQuestClaims: true,
      akibaFundedVouchers: false,
      quests: false,
      discoveryContributions: false,
      milesEarnedNotifications: false,
      gifts: false,
    },
    legal: {
      privacyUrl: 'https://app.akibamiles.com/privacy-policy',
      termsUrl: 'https://app.akibamiles.com/terms-of-use',
      accountDeletionUrl: 'https://app.akibamiles.com/account-deletion',
      deletionPolicyVersion: '2026-10-10.1',
    },
    storeUrl: { ios: null, android: null },
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders versions by each numeric segment, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal regardless of surrounding whitespace', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions(' 1.2.3 ', '1.2.3')).toBe(0);
  });

  it('treats a missing segment as zero so 1.2 equals 1.2.0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('never blocks a build because of an unparseable segment', () => {
    // A build labelled 1.3.0-beta.2 must compare as 1.3.0, not as 0.
    expect(compareVersions('1.3.0-beta.2', '1.2.0')).toBeGreaterThan(0);
  });
});

describe('resolveLaunchGate', () => {
  it('lets a supported build through', () => {
    expect(
      resolveLaunchGate({ config: config(), platform: 'ios', installedVersion: '1.2.0' }),
    ).toBe('ok');
    expect(
      resolveLaunchGate({ config: config(), platform: 'android', installedVersion: '1.4.1' }),
    ).toBe('ok');
  });

  it('blocks a build below the platform minimum', () => {
    expect(
      resolveLaunchGate({ config: config(), platform: 'ios', installedVersion: '1.1.9' }),
    ).toBe('upgrade_required');
  });

  it('reads the minimum for the platform it was asked about', () => {
    const split = config({ minimumSupportedVersion: { ios: '2.0.0', android: '1.0.0' } });
    expect(resolveLaunchGate({ config: split, platform: 'ios', installedVersion: '1.5.0' })).toBe(
      'upgrade_required',
    );
    expect(
      resolveLaunchGate({ config: split, platform: 'android', installedVersion: '1.5.0' }),
    ).toBe('ok');
  });

  it('shows maintenance ahead of an upgrade prompt', () => {
    // Telling someone to update during a maintenance window sends them to
    // fix the wrong problem — and the new build would be just as down.
    expect(
      resolveLaunchGate({
        config: config({ maintenance: true }),
        platform: 'ios',
        installedVersion: '0.9.0',
      }),
    ).toBe('maintenance');
  });
});
