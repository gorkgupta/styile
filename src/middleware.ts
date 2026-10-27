import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Signed-in areas. Role checks (owner vs stylist, platform admin) happen in each layout on the server.
const PROTECTED = ['/app', '/admin', '/me', '/onboarding'];

export async function middleware(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const path = request.nextUrl.pathname;
  if (!userId && PROTECTED.some((p) => path === p || path.startsWith(p + '/'))) {
    const url = request.nextUrl.clone();
    url.pathname = path.startsWith('/me') ? '/me/login' : '/login';
    url.searchParams.set('next', path);
    if (path === '/me/login') return response;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static files, images and the webhook/cron endpoints (they authenticate themselves).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|api/whatsapp|api/cron|api/auth/sms-hook|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};
