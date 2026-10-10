/**
 * `a••••@example.com` — enough for a member to recognise the address they
 * verified, not enough to be a useful leak if a response is logged.
 *
 * Its own module so a server component (the public /account-deletion page)
 * can mask an address without importing the whole deletion domain, which
 * pulls in the admin client, rate limiter, and balance loaders.
 */
export function maskEmail(email: string | null): string {
  if (!email) return "your account email";
  const [local, domain] = email.split("@");
  if (!domain) return "your account email";
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
