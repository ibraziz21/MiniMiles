/** Same-origin return destinations only; never send onboarding back into itself. */
export function onboardingReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  const pathname = value.split(/[?#]/)[0];
  if (['/welcome', '/login', '/join', '/auth'].some(path => pathname === path || pathname.startsWith(`${path}/`))) return '/';
  return value;
}

export function needsWebOnboarding(pass: { onboarding_required?: boolean; onboarding_seen_at: string | null } | null): boolean {
  return pass?.onboarding_required === true && !pass.onboarding_seen_at;
}
