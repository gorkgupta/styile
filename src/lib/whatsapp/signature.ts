// Webhook signature checks using Web Crypto (works on Cloudflare Workers and Node 20+).

const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Meta signs webhook bodies: header `X-Hub-Signature-256: sha256=<hex hmac of raw body with the app secret>`. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = toHex(await hmac(enc.encode(appSecret), rawBody));
  return timingSafeEqual(header.slice(7).toLowerCase(), expected);
}

/**
 * Supabase auth hooks use Standard Webhooks: headers webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>" …),
 * secret shown in the dashboard as "v1,whsec_<base64>". Rejects messages older than 5 minutes.
 */
export async function verifyStandardWebhook(rawBody: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = headers.get('webhook-signature');
  if (!id || !ts || !sigs || !secret) return false;
  if (!/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const key = fromB64(secret.replace(/^v1,/, '').replace(/^whsec_/, ''));
  const expected = toB64(await hmac(key, `${id}.${ts}.${rawBody}`));
  return sigs.split(' ').some((s) => {
    const [version, sig] = s.split(',');
    return version === 'v1' && !!sig && timingSafeEqual(sig, expected);
  });
}

export const __test = { hmac, toHex, toB64 };
