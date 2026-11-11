import { Linking } from 'react-native';

/**
 * Links a merchant typed into their profile (website, socials, maps link,
 * phone) are opened only when they are an ordinary web page, a phone number
 * or an email address. Anything else — another app's custom scheme, an
 * Android intent: URL, javascript:, a file — is dropped. The server checks
 * these when a profile is published, but not on every later edit, so the
 * app does not rely on that.
 */
const ALLOWED_PROTOCOLS = new Set(['https:', 'tel:', 'mailto:']);

export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  const protocol = /^([a-z][a-z0-9+.-]*:)/i.exec(value)?.[1]?.toLowerCase();
  if (!protocol || !ALLOWED_PROTOCOLS.has(protocol)) return null;

  if (protocol === 'https:') {
    try {
      const url = new URL(value);
      return url.hostname ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (protocol === 'tel:') {
    // Digits, spaces, dashes, brackets and a leading plus — nothing a dialler
    // could read as a command.
    const number = value.slice(4).replace(/[\s().-]/g, '');
    return /^\+?\d{3,20}$/.test(number) ? `tel:${number}` : null;
  }
  const address = value.slice(7);
  return /^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(address) ? `mailto:${address}` : null;
}

/** Opens a merchant link if it is safe; returns false when it was refused or failed. */
export async function openExternalUrl(raw: string | null | undefined): Promise<boolean> {
  const url = safeExternalUrl(raw);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
