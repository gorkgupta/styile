import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { PATH_HEADER, routeRequest, SALON_HEADER } from '@/lib/tenant';

// Signed-in areas. Role checks (owner vs stylist, platform admin) happen in each layout on the server.
// Client pages (/me) check sign-in themselves so they can send people to the right salon's login.
const PROTECTED = ['/app', '/admin', '/onboarding'];

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const decision = routeRequest(request.headers.get('host'), url.pathname, url.search);
  if (decision.kind === 'redirect') return NextResponse.redirect(new URL(decision.url, request.url), 308);

  // Never trust a salon header sent by the browser; set it only from the host name.
  const headers = new Headers(request.headers);
  headers.delete(SALON_HEADER);
  if (decision.salon) headers.set(SALON_HEADER, decision.salon);
  headers.set(PATH_HEADER, url.pathname + url.search);

  let rewriteTo: URL | undefined;
  if (decision.kind === 'rewrite') {
    rewriteTo = url.clone();
    rewriteTo.pathname = decision.pathname;
  }

  const { response, userId } = await updateSession(request, headers, rewriteTo);
  if (!userId && PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) {
    const login = url.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set('next', url.pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // Skip static files, images and the webhook/cron endpoints (they authenticate themselves).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|api/whatsapp|api/cron|api/auth/sms-hook|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};
