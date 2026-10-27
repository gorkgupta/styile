// Which salon a request is for, and how to link to a salon's own site.
// Pure and edge-safe: used by the middleware, server code and client components alike.
//
// Production: every salon has its own address, https://<slug>.styile.com
//   /          -> the salon's booking page
//   /me        -> the client's bookings, bills and coins at this salon only
//   /app       -> staff app, locked to this salon
// Without NEXT_PUBLIC_ROOT_DOMAIN (local dev, preview deploys) the same pages live under /s/<slug>.

/** Subdomains that can never be a salon (also enforced in the database). */
export const RESERVED_SLUGS = [
  'www', 'app', 'admin', 'api', 'auth', 'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'images',
  'help', 'support', 'docs', 'blog', 'status', 'about', 'pricing', 'login', 'signup', 'signin', 'register', 'account',
  'billing', 'dashboard', 'me', 'my', 'book', 'booking', 'styile', 'test', 'demo', 'dev', 'staging', 'beta', 'm', 'wa', 'whatsapp',
] as const;

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
export const SALON_HEADER = 'x-styile-salon';
/** Original path + query of the request (set by the middleware), for redirects to a salon's address. */
export const PATH_HEADER = 'x-styile-path';

export function isReservedSlug(slug: string) {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/** "styile.com" in production, "localhost:3000" in dev, "" when subdomains are off. */
export function rootDomain(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function protocolFor(root: string) {
  return /^localhost(:\d+)?$/.test(root) || root.endsWith('.localhost') ? 'http' : 'https';
}

/** The salon slug for a Host header, or null for the main site / unknown hosts. */
export function salonSlugFromHost(host: string | null | undefined, root = rootDomain()): string | null {
  if (!host || !root) return null;
  const h = host.trim().toLowerCase();
  if (!h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  if (!sub || sub.includes('.') || isReservedSlug(sub) || !SLUG_RE.test(sub)) return null;
  return sub;
}

/** Cookie domain shared by the main site and every salon site, so one login works everywhere. */
export function cookieDomain(root = rootDomain()): string | undefined {
  if (!root || protocolFor(root) === 'http') return undefined; // browsers don't share cookies across *.localhost
  return `.${root.replace(/:\d+$/, '')}`;
}

/** Absolute URL of a salon's own site. path starts with "/" ("" = booking page). */
export function salonUrl(slug: string, path = '', root = rootDomain()): string {
  if (root) return `${protocolFor(root)}://${slug}.${root}${path}`;
  const app = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return `${app}/s/${slug}${path}`;
}

/** Human-friendly address to show: "glowstudio.styile.com" (or "styile.com/s/glowstudio"). */
export function salonAddress(slug: string, root = rootDomain()): string {
  if (root) return `${slug}.${root}`;
  const app = (process.env.NEXT_PUBLIC_APP_URL || 'styile.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${app}/s/${slug}`;
}

/** Absolute URL on the main site (sign-up, admin). */
export function mainUrl(path = '', root = rootDomain()): string {
  if (root) return `${protocolFor(root)}://${root}${path}`;
  return `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}${path}`;
}

/**
 * Prefix for links inside a salon site: "" when the page is being served on the salon's own subdomain,
 * "/s/<slug>" when it is served under the path fallback.
 */
export function siteBase(slug: string, servedOnSubdomain: boolean) {
  return servedOnSubdomain ? '' : `/s/${slug}`;
}

export type RouteDecision =
  | { kind: 'next' }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'redirect'; url: string };

/** Paths a salon site serves itself; everything else on a salon host goes to the main site. */
const SALON_SITE_PATHS = [/^\/$/, /^\/me(\/.*)?$/, /^\/app(\/.*)?$/, /^\/login$/, /^\/reset$/, /^\/api\//, /^\/b\//];

/**
 * Routing rules shared by the middleware and tests.
 * - salon host: "/" and "/me/*" are served from /s/<slug>/...; /app, /login stay; sign-up/admin go to the main site.
 * - main host: old /s/<slug>/... links move to the salon's own address (when subdomains are on).
 */
export function routeRequest(host: string | null, pathname: string, search = '', root = rootDomain()): RouteDecision & { salon: string | null } {
  const salon = salonSlugFromHost(host, root);
  if (salon) {
    if (pathname === '/' ) return { kind: 'rewrite', pathname: `/s/${salon}`, salon };
    if (/^\/me(\/.*)?$/.test(pathname)) return { kind: 'rewrite', pathname: `/s/${salon}${pathname}`, salon };
    if (pathname.startsWith('/s/')) {
      const [, , slug, ...rest] = pathname.split('/');
      return { kind: 'redirect', url: slug === salon ? `/${rest.join('/')}${search}` : salonUrl(slug, `/${rest.join('/')}`, root) + search, salon };
    }
    if (SALON_SITE_PATHS.some((re) => re.test(pathname))) return { kind: 'next', salon };
    return { kind: 'redirect', url: mainUrl(pathname, root) + search, salon };
  }
  if (root && pathname.startsWith('/s/')) {
    const [, , slug, ...rest] = pathname.split('/');
    if (slug && SLUG_RE.test(slug)) return { kind: 'redirect', url: salonUrl(slug, rest.length ? `/${rest.join('/')}` : '', root) + search, salon: null };
  }
  return { kind: 'next', salon: null };
}
