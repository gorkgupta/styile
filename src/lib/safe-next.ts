/**
 * A same-site path to send someone after login, or null. Browsers treat "\" like "/" and drop tabs/newlines,
 * so "/\evil.com" or "/\t/evil.com" would otherwise become the protocol-relative "//evil.com".
 */
export function safeNextPath(next: unknown): string | null {
  return typeof next === 'string' && /^\/(?![/\\])[^\\\x00-\x20\x7f]*$/.test(next) ? next : null;
}
