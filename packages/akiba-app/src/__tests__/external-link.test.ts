import { describe, expect, it, vi } from 'vitest';

const linking = vi.hoisted(() => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('react-native', () => ({ Linking: linking }));

const { openExternalUrl, safeExternalUrl } = await import('@/lib/external-link');

describe('safeExternalUrl', () => {
  it('allows ordinary web pages, phone numbers and email addresses', () => {
    expect(safeExternalUrl('https://kahawa.co.ke/menu')).toBe('https://kahawa.co.ke/menu');
    expect(safeExternalUrl(' https://instagram.com/kahawa ')).toBe('https://instagram.com/kahawa');
    expect(safeExternalUrl('tel:+254 (712) 345-678')).toBe('tel:+254712345678');
    expect(safeExternalUrl('mailto:hello@kahawa.co.ke')).toBe('mailto:hello@kahawa.co.ke');
  });

  it('refuses everything else a merchant could type', () => {
    for (const url of [
      'javascript:alert(1)',
      'intent://scan/#Intent;scheme=zxing;end',
      'mpesa://pay?amount=1000',
      'file:///etc/passwd',
      'http://kahawa.co.ke',
      'data:text/html,hi',
      'tel:*334#',
      'mailto:hello@kahawa.co.ke?body=x',
      'kahawa.co.ke',
      '',
      null,
      undefined,
    ]) {
      expect(safeExternalUrl(url)).toBeNull();
    }
  });
});

describe('openExternalUrl', () => {
  it('opens a safe link and quietly refuses an unsafe one', async () => {
    expect(await openExternalUrl('https://kahawa.co.ke')).toBe(true);
    expect(await openExternalUrl('intent://x')).toBe(false);
    expect(linking.openURL.mock.calls).toEqual([['https://kahawa.co.ke/']]);
  });
});
