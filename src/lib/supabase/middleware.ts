import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookieDomain } from '@/lib/tenant';

/**
 * Refreshes the Supabase session cookie on every request and returns the signed-in user id (or null).
 * `headers` are the request headers forwarded to the page (the middleware adds the salon header);
 * `rewriteTo` serves another route at the same URL (salon subdomains).
 */
export async function updateSession(request: NextRequest, headers: Headers, rewriteTo?: URL) {
  const make = () => {
    headers.set('cookie', request.cookies.toString());
    return rewriteTo ? NextResponse.rewrite(rewriteTo, { request: { headers } }) : NextResponse.next({ request: { headers } });
  };
  let response = make();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { domain: cookieDomain() },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = make();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  return { response, userId: data.user?.id ?? null };
}
