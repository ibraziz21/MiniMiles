// lib/referrals.ts
export function generateCode(len = 6) {
    // base36, uppercase, no confusing chars
    return [...crypto.getRandomValues(new Uint32Array(len))]
      .map(n => (n % 36).toString(36))
      .join('')
      .toUpperCase();
  }