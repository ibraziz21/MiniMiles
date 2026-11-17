export async function verifyTurnstile(token: string, ip?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Anti-spam verification is not configured." };
    }
    return { ok: true };
  }

  if (!token) {
    return { ok: false, error: "Complete the anti-spam check." };
  }

  const params = new FormData();
  params.append("secret", secret);
  params.append("response", token);
  if (ip) params.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: params,
  });

  if (!res.ok) {
    return { ok: false, error: "Anti-spam verification failed." };
  }

  const result = (await res.json()) as { success?: boolean };
  if (!result.success) {
    return { ok: false, error: "Anti-spam verification failed." };
  }

  return { ok: true };
}
