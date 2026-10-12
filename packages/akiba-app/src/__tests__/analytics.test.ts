import { describe, expect, it } from 'vitest';

import { REDACTED, scrubProps } from '@/analytics/track';

describe('scrubProps', () => {
  it('keeps ordinary non-PII props untouched', () => {
    expect(scrubProps({ step: 'profile', position: 2, total: 3, resumed: false })).toEqual({
      step: 'profile',
      position: 2,
      total: 3,
      resumed: false,
    });
  });

  it('drops every prop the spec forbids, by key', () => {
    const scrubbed = scrubProps({
      email: 'member@example.com',
      otp: '123456',
      access_token: 'ey.aaa.bbb',
      verificationCode: '123456',
      phone: '+254700000000',
      lat: -1.2921,
      lng: 36.8219,
      latitude: -1.2921,
      step: 'welcome',
    });
    expect(scrubbed).toEqual({ step: 'welcome' });
  });

  it('drops the identifiers and balances AKIBA-MOB-002 §14 bars as well', () => {
    const scrubbed = scrubProps({
      user_id: 'u-1',
      requestId: 'req-1',
      voucher_id: 'v-1',
      walletAddress: '0xabc',
      milesBalance: 1250,
      platform: 'ios',
      already_requested: true,
    });
    expect(scrubbed).toEqual({ platform: 'ios', already_requested: true });
  });

  it('does not mistake an allowed key for a coordinate', () => {
    // A substring match on /lat/ also hits "platform", which §14 allows.
    expect(scrubProps({ platform: 'android', appVersion: '1.0.0' })).toEqual({
      platform: 'android',
      appVersion: '1.0.0',
    });
    expect(scrubProps({ lat: 1, lng: 2, latitude: 3, longitude: 4 })).toEqual({});
  });

  it('keeps the bounded error and failure codes §14 explicitly allows', () => {
    // The failure events exist to carry these; blocking every key matching
    // /code/ would have made them useless.
    expect(scrubProps({ errorCode: 'OTP_INVALID' }).errorCode).toBe('OTP_INVALID');
    expect(scrubProps({ failure_code: 'step_failed' }).failure_code).toBe('step_failed');
    expect(scrubProps({ verificationCode: '123456' }).verificationCode).toBeUndefined();
  });

  it('redacts an email or token hiding under an innocent key', () => {
    expect(scrubProps({ actor: 'member@example.com' }).actor).toBe(REDACTED);
    expect(scrubProps({ reason: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' }).reason).toBe(REDACTED);
  });

  it('leaves short opaque-looking values alone', () => {
    // Error reasons like `http_401` are the point of the prop; only
    // token-length strings are suspicious.
    expect(scrubProps({ reason: 'http_401' }).reason).toBe('http_401');
    expect(scrubProps({ stage: 'config' }).stage).toBe('config');
  });

  it('omits undefined rather than sending it', () => {
    expect(scrubProps({ step: undefined, position: 1 })).toEqual({ position: 1 });
    expect(scrubProps()).toEqual({});
  });
});
